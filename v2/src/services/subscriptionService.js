const { pool, withTransaction } = require('../db');
const { AppError } = require('../errors');
const { WEEKDAYS } = require('../validation/common');
const clock = require('../clock');
const { requestRefund, paymentSummaryForSubscription } = require('./paymentService');

const MAX_START_AHEAD_DAYS = 30;  // a subscription starts within a month
const MAX_PAUSE_DAYS = 60;        // one skip/pause request covers at most 60 calendar days
const MAX_SKIP_AHEAD_DAYS = 120;  // and ends within 4 months
const PROJECTION_LIMIT_DAYS = 400;

const SUB_COLUMNS = `s.id, s.user_id, s.plan_id, s.address_id, s.status,
  s.plan_name_snapshot, s.price_paise_snapshot, s.meal_slot, s.meals_total, s.delivery_weekdays,
  s.start_date, s.end_date, s.cancelled_at, s.cancelled_by_actor, s.cancel_reason, s.created_at,
  p.restaurant_id, r.name AS restaurant_name, r.owner_user_id, a.label AS address_label,
  (SELECT count(*)::int FROM subscription_deliveries d
    WHERE d.subscription_id = s.id AND d.status = 'delivered') AS meals_delivered,
  (SELECT count(*)::int FROM subscription_deliveries d
    WHERE d.subscription_id = s.id AND d.status = 'scheduled') AS meals_scheduled,
  (SELECT count(*)::int FROM subscription_deliveries d
    WHERE d.subscription_id = s.id AND d.status = 'missed') AS meals_missed`;

const SUB_FROM = `FROM subscriptions s
  JOIN subscription_plans p ON p.id = s.plan_id
  JOIN restaurants r ON r.id = p.restaurant_id
  JOIN addresses a ON a.id = s.address_id`;

const subscriptionNotFound = () =>
  new AppError(404, 'SUBSCRIPTION_NOT_FOUND', 'Subscription not found');

async function loadRow(db, id) {
  const { rows } = await db.query(`SELECT ${SUB_COLUMNS} ${SUB_FROM} WHERE s.id = $1`, [id]);
  return rows[0] ?? null;
}

// A subscription reaches the restaurant only once paid, like an order.
const HIDDEN_FROM_RESTAURANT = ['awaiting_payment', 'expired'];

// In what capacity the user relates to this subscription (as for orders).
function actorFor(user, row) {
  if (user.role === 'admin') return 'admin';
  if (row.owner_user_id === user.id && !HIDDEN_FROM_RESTAURANT.includes(row.status)) return 'restaurant';
  if (row.user_id === user.id) return 'customer';
  return null;
}

// Who may cancel from which status. The restaurant never sees an unpaid subscription.
const CANCELLABLE_FROM = {
  customer: ['awaiting_payment', 'active'],
  restaurant: ['active'],
  admin: ['awaiting_payment', 'active'],
};

// Meals not yet delivered or scheduled. A missed delivery doesn't use up a meal (it is owed).
const mealsUnscheduled = (row) => row.meals_total - row.meals_delivered - row.meals_scheduled;

// The refund for unused meals, rounded down to whole paise, so the refunds can never
// add up to more than was paid.
const proRataRefundPaise = (paidPaise, unusedMeals, totalMeals) =>
  Math.floor((paidPaise * unusedMeals) / totalMeals);

// Where the remaining meals will fall: from the first date still open, on the picked weekdays,
// leaving out skipped dates. Locked dates already have their delivery rows.
function project(row, skipDates, now) {
  if (row.status !== 'active') return { upcomingDates: [], projectedLastDate: null };
  const skipped = new Set(skipDates);
  const dates = [];
  let remaining = mealsUnscheduled(row);
  let day = [row.start_date, clock.firstOpenDate(now)].sort()[1]; // the later of the two
  for (let i = 0; remaining > 0 && i < PROJECTION_LIMIT_DAYS; i++, day = clock.addDays(day, 1)) {
    if (row.delivery_weekdays.includes(clock.isoWeekday(day)) && !skipped.has(day)) {
      dates.push(day);
      remaining--;
    }
  }
  return { upcomingDates: dates.slice(0, 5), projectedLastDate: dates.at(-1) ?? null };
}

function toSummary(row) {
  return {
    id: row.id,
    status: row.status,
    customerId: row.user_id,
    plan: {
      id: row.plan_id,
      name: row.plan_name_snapshot,
      mealSlot: row.meal_slot,
      mealsTotal: row.meals_total,
      pricePaise: row.price_paise_snapshot,
    },
    restaurant: { id: row.restaurant_id, name: row.restaurant_name },
    address: { id: row.address_id, label: row.address_label },
    weekdays: row.delivery_weekdays.map((n) => WEEKDAYS[n - 1]),
    startDate: row.start_date,
    endDate: row.end_date,
    progress: {
      delivered: row.meals_delivered,
      scheduled: row.meals_scheduled,
      missed: row.meals_missed,
      remaining: row.meals_total - row.meals_delivered,
    },
    cancelled: row.cancelled_at
      ? { at: row.cancelled_at, by: row.cancelled_by_actor, reason: row.cancel_reason }
      : null,
    createdAt: row.created_at,
  };
}

async function toDetail(db, row) {
  const now = clock.istNow();
  const skips = await db.query(
    `SELECT skip_date, kind FROM subscription_skips
     WHERE subscription_id = $1 AND skip_date >= $2 ORDER BY skip_date`,
    [row.id, now.date],
  );
  const deliveries = await db.query(
    `SELECT id, delivery_date, status FROM subscription_deliveries
     WHERE subscription_id = $1 ORDER BY delivery_date DESC LIMIT 10`,
    [row.id],
  );
  const projection = project(row, skips.rows.map((s) => s.skip_date), now);
  return {
    ...toSummary(row),
    upcomingSkips: skips.rows.map((s) => ({ date: s.skip_date, kind: s.kind })),
    recentDeliveries: deliveries.rows.map((d) => ({ id: d.id, date: d.delivery_date, status: d.status })),
    nextDeliveryDates: projection.upcomingDates,
    projectedLastDate: projection.projectedLastDate,
    payment: await paymentSummaryForSubscription(db, row.id),
  };
}

async function subscribe(user, input) {
  const now = clock.istNow();
  const firstOpen = clock.firstOpenDate(now);
  const startDate = input.startDate ?? firstOpen;
  // A start date that is already locked can't be honoured.
  if (startDate < firstOpen) {
    throw new AppError(422, 'START_DATE_LOCKED', `The earliest possible start date is ${firstOpen}`,
      { firstOpenDate: firstOpen });
  }
  if (startDate > clock.addDays(now.date, MAX_START_AHEAD_DAYS)) {
    throw new AppError(422, 'START_DATE_TOO_FAR',
      `A subscription must start within ${MAX_START_AHEAD_DAYS} days`);
  }

  try {
    const id = await withTransaction(async (client) => {
      const addr = await client.query(
        'SELECT id FROM addresses WHERE id = $1 AND user_id = $2', [input.addressId, user.id]);
      if (!addr.rows[0]) throw new AppError(404, 'ADDRESS_NOT_FOUND', 'Address not found');

      // The plan must be on sale at an active restaurant that delivers to this address.
      // FOR SHARE: a concurrent price change waits for this subscription (as for orders).
      const plan = await client.query(
        `SELECT p.name, p.price_paise, p.meal_slot, p.meals_count, r.delivery_radius_m,
                ST_Distance(r.location, a.location) AS distance_m
         FROM subscription_plans p
         JOIN restaurants r ON r.id = p.restaurant_id
         CROSS JOIN addresses a
         WHERE p.id = $1 AND p.is_active AND r.is_active AND a.id = $2
         FOR SHARE OF p`,
        [input.planId, input.addressId],
      );
      const p = plan.rows[0];
      if (!p) throw new AppError(404, 'PLAN_NOT_FOUND', 'Plan not found');
      if (p.distance_m > p.delivery_radius_m) {
        throw new AppError(422, 'NOT_SERVICEABLE', 'This restaurant does not deliver to this address', {
          distanceM: Math.round(p.distance_m),
          deliveryRadiusM: p.delivery_radius_m,
        });
      }

      // Snapshots of what was bought (as for orders). It becomes 'active'
      // once paid; the route starts the checkout.
      const inserted = await client.query(
        `INSERT INTO subscriptions (user_id, plan_id, address_id, status, plan_name_snapshot,
                                    price_paise_snapshot, meal_slot, meals_total, delivery_weekdays,
                                    start_date)
         VALUES ($1, $2, $3, 'awaiting_payment', $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [user.id, input.planId, input.addressId, p.name, p.price_paise, p.meal_slot,
          p.meals_count, input.weekdays, startDate],
      );
      return inserted.rows[0].id;
    });
    return getSubscription(user, id);
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'subscriptions_one_active_per_plan_address') {
      // Point to the existing one: often it's the same customer retrying before paying.
      const { rows } = await pool.query(
        `SELECT id, status FROM subscriptions
         WHERE plan_id = $1 AND address_id = $2 AND status IN ('awaiting_payment', 'active')`,
        [input.planId, input.addressId],
      );
      throw new AppError(409, 'SUBSCRIPTION_EXISTS',
        'You already have a subscription to this plan for this address',
        rows[0] ? { subscriptionId: rows[0].id, status: rows[0].status } : undefined);
    }
    throw err;
  }
}

async function listMySubscriptions(userId) {
  const { rows } = await pool.query(
    `SELECT ${SUB_COLUMNS} ${SUB_FROM}
     WHERE s.user_id = $1
     ORDER BY s.created_at DESC, s.id DESC
     LIMIT 50`,
    [userId],
  );
  return rows.map(toSummary);
}

// Customer, the restaurant's owner, or an admin may view; everyone else gets 404.
async function getSubscription(user, id) {
  const row = await loadRow(pool, id);
  if (!row || !actorFor(user, row)) throw subscriptionNotFound();
  return toDetail(pool, row);
}

// The customer, the restaurant or an admin may cancel. Compare-and-set on the status
// that was read. Deliveries already locked for tomorrow stay scheduled and are delivered.
// A paid subscription refunds its unused meals pro rata, recorded in this transaction and
// sent by the refund job.
async function cancelSubscription(user, id, reason) {
  return withTransaction(async (client) => {
    const row = await loadRow(client, id);
    const actor = row && actorFor(user, row);
    if (!actor) throw subscriptionNotFound();
    const allowedFrom = CANCELLABLE_FROM[actor];
    const updated = allowedFrom.includes(row.status)
      ? await client.query(
        `UPDATE subscriptions
         SET status = 'cancelled', cancelled_at = now(), cancelled_by_actor = $3, cancel_reason = $4
         WHERE id = $1 AND status = $2`,
        [id, row.status, actor, reason ?? null],
      )
      : { rowCount: 0 };
    if (updated.rowCount === 0) {
      throw new AppError(409, 'CANCEL_NOT_ALLOWED', `A ${row.status} subscription cannot be cancelled`,
        { status: row.status, allowedFrom });
    }

    // Counted after the UPDATE: it holds the row lock the nightly job also takes, so no
    // delivery can be added between this count and the commit.
    const after = await loadRow(client, id);
    const paid = await client.query(
      "SELECT id, amount_paise FROM payments WHERE subscription_id = $1 AND status = 'paid'", [id]);
    if (paid.rows[0]) {
      const unused = mealsUnscheduled(after);
      const amount = proRataRefundPaise(paid.rows[0].amount_paise, unused, after.meals_total);
      if (amount > 0) {
        await requestRefund(client, paid.rows[0].id, amount,
          `Subscription cancelled by ${actor}: ${unused} of ${after.meals_total} meals unused`);
      }
    }
    return toDetail(client, after);
  });
}

// ---------------------------------------------------------------------------------------------
// Skips and pauses. Only the customer may skip their own deliveries.

async function loadForCustomerChange(client, user, id) {
  // FOR UPDATE OF s: serialises with the nightly job, which locks the same rows.
  const { rows } = await client.query(
    `SELECT ${SUB_COLUMNS} ${SUB_FROM} WHERE s.id = $1 FOR UPDATE OF s`, [id]);
  const row = rows[0];
  const actor = row && actorFor(user, row);
  if (!actor) throw subscriptionNotFound();
  if (row.user_id !== user.id) {
    throw new AppError(403, 'FORBIDDEN', 'Only the customer can skip or pause deliveries');
  }
  if (row.status !== 'active') {
    throw new AppError(409, 'SUBSCRIPTION_NOT_ACTIVE', `The subscription is ${row.status}`,
      { status: row.status });
  }
  return row;
}

function assertOpen(date, now) {
  const firstOpen = clock.firstOpenDate(now);
  if (date < firstOpen) {
    throw new AppError(422, 'DATE_LOCKED',
      `Deliveries up to ${clock.addDays(firstOpen, -1)} are already locked (cutoff 9 PM the day before)`,
      { firstOpenDate: firstOpen });
  }
}

// One date (a skip) or a range (a pause). Only the subscription's delivery days in the range are
// stored; each one postpones a meal, so nothing paid for is lost.
async function addSkips(user, id, { from, to }) {
  const now = clock.istNow();
  const kind = from === to ? 'skip' : 'pause';
  if (to < from) throw new AppError(422, 'INVALID_RANGE', '"to" must not be before "from"');
  assertOpen(from, now);
  if (clock.addDays(from, MAX_PAUSE_DAYS - 1) < to) {
    throw new AppError(422, 'RANGE_TOO_LONG', `A pause can cover at most ${MAX_PAUSE_DAYS} days`);
  }
  if (to > clock.addDays(now.date, MAX_SKIP_AHEAD_DAYS)) {
    throw new AppError(422, 'DATE_TOO_FAR', `Skips must be within ${MAX_SKIP_AHEAD_DAYS} days`);
  }

  return withTransaction(async (client) => {
    const row = await loadForCustomerChange(client, user, id);
    const dates = [];
    for (let d = from; d <= to; d = clock.addDays(d, 1)) {
      if (d >= row.start_date && row.delivery_weekdays.includes(clock.isoWeekday(d))) dates.push(d);
    }
    if (dates.length === 0) {
      throw new AppError(422, 'NO_DELIVERY_DAYS', 'There are no delivery days in this range');
    }
    // A delivery row means the job has already locked that day (even if the clock check passed).
    const locked = await client.query(
      `SELECT delivery_date FROM subscription_deliveries
       WHERE subscription_id = $1 AND delivery_date = ANY($2::date[])`,
      [id, dates],
    );
    if (locked.rows.length > 0) {
      throw new AppError(422, 'DATE_LOCKED', 'Some of these deliveries are already locked',
        { dates: locked.rows.map((r) => r.delivery_date) });
    }
    const inserted = await client.query(
      `INSERT INTO subscription_skips (subscription_id, skip_date, kind)
       SELECT $1, d, $3 FROM unnest($2::date[]) AS d
       ON CONFLICT (subscription_id, skip_date) DO NOTHING
       RETURNING skip_date`,
      [id, dates, kind],
    );
    const added = inserted.rows.map((r) => r.skip_date).sort();
    return {
      kind,
      skipped: added,
      alreadySkipped: dates.filter((d) => !added.includes(d)),
      subscription: await toDetail(client, await loadRow(client, id)),
    };
  });
}

async function removeSkip(user, id, date) {
  assertOpen(date, clock.istNow());
  return withTransaction(async (client) => {
    await loadForCustomerChange(client, user, id);
    const removed = await client.query(
      'DELETE FROM subscription_skips WHERE subscription_id = $1 AND skip_date = $2',
      [id, date],
    );
    if (removed.rowCount === 0) throw new AppError(404, 'SKIP_NOT_FOUND', 'That date is not skipped');
  });
}

module.exports = {
  subscribe,
  listMySubscriptions,
  getSubscription,
  cancelSubscription,
  addSkips,
  removeSkip,
  project,
  proRataRefundPaise,
};

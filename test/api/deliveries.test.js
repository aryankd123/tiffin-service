// Skips and pauses, the nightly delivery job, marking deliveries, completion, auto-cancel and
// the scheduler's lock (K1-K8, J1-J5, W1-W10, X1-X4). Days that must already have passed are
// simulated by moving dates in SQL; jobs are called directly.
const { pool } = require('../../src/db');
const clock = require('../../src/clock');
const { scheduleDeliveries } = require('../../src/jobs/subscriptionDeliveries');
const { cancelUnconfirmedOrders } = require('../../src/jobs/autoCancelOrders');
const { tick, JOB_LOCK_ID } = require('../../src/jobs/scheduler');
const { call, login, registerUser, errorCode, placePaidOrder, subscribePaid } = require('../helpers/api');
const { resetWorld } = require('../helpers/world');

const now = clock.istNow();
const today = now.date;
const firstOpen = clock.firstOpenDate(now);

let world; let customer; let vendor; let stranger; let k; let kSub; let start; let kDelivery;
const d = (n) => clock.addDays(start, n); // start is a Monday: d(2) is Wednesday, …

const deliveryOf = async (subId, date) => (await pool.query(
  'SELECT id, status, delivery_line FROM subscription_deliveries WHERE subscription_id = $1 AND delivery_date = $2',
  [subId, date])).rows[0] ?? null;
const skip = (token, id, body) => call('POST', `/subscriptions/${id}/skips`, { token, body });
const newPlan = async (name) => (await call('POST', `/restaurants/${k.id}/plans`, {
  token: vendor.token, body: { name, mealSlot: 'lunch', mealsCount: 5, pricePaise: 60000 },
})).body.plan.id;

beforeAll(async () => {
  world = await resetWorld();
  customer = await login(world.users.customer.email);
  vendor = await login(world.users.vendor.email);
  stranger = await registerUser('deliveries.stranger');
  k = world.restaurants.koramangala;
  // K-subscription: Mon/Wed/Fri, starting on a Monday at least a week away (clear of the cutoff).
  start = clock.addDays(firstOpen, 7);
  while (clock.isoWeekday(start) !== 1) start = clock.addDays(start, 1);
  kSub = await subscribePaid(customer.token, { planId: await newPlan('K Lunches'), addressId: world.addresses.home, weekdays: ['mon', 'wed', 'fri'], startDate: start });
});

describe('skips and pauses (K1-K8)', () => {
  test('K0: five meals on Mon/Wed/Fri end on the second Wednesday', () => {
    expect(kSub.projectedLastDate).toBe(d(9));
  });

  test('K1-K2: a locked day or a day without a delivery cannot be skipped', async () => {
    const locked = await skip(customer.token, kSub.id, { date: today });
    expect([locked.status, errorCode(locked)]).toEqual([422, 'DATE_LOCKED']);
    const tuesday = await skip(customer.token, kSub.id, { date: d(1) });
    expect([tuesday.status, errorCode(tuesday)]).toEqual([422, 'NO_DELIVERY_DAYS']);
  });

  test('K3-K4: skipping a delivery day postpones that meal; skipping it twice is harmless', async () => {
    const res = await skip(customer.token, kSub.id, { date: d(2) });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'skip', skipped: [d(2)], alreadySkipped: [] });
    expect(res.body.subscription.projectedLastDate).toBe(d(11));
    const again = await skip(customer.token, kSub.id, { date: d(2) });
    expect(again.body).toMatchObject({ skipped: [], alreadySkipped: [d(2)] });
  });

  test('K5: pausing a week skips only its delivery days', async () => {
    const res = await skip(customer.token, kSub.id, { from: d(7), to: d(13) });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'pause', skipped: [d(7), d(9), d(11)] });
    expect(res.body.subscription.projectedLastDate).toBe(d(18));
  });

  test('K6: pause limits and malformed bodies', async () => {
    const long = await skip(customer.token, kSub.id, { from: d(20), to: d(80) });
    expect([long.status, errorCode(long)]).toEqual([422, 'RANGE_TOO_LONG']);
    const backwards = await skip(customer.token, kSub.id, { from: d(21), to: d(20) });
    expect([backwards.status, errorCode(backwards)]).toEqual([422, 'INVALID_RANGE']);
    expect((await skip(customer.token, kSub.id, { date: d(21), from: d(21) })).status).toBe(400);
  });

  test('K7: only the customer may skip', async () => {
    const byKitchen = await skip(vendor.token, kSub.id, { date: d(4) });
    expect([byKitchen.status, errorCode(byKitchen)]).toEqual([403, 'FORBIDDEN']);
    expect((await skip(stranger.token, kSub.id, { date: d(4) })).status).toBe(404);
  });

  test('K8: un-skipping brings the meal back', async () => {
    expect((await call('DELETE', `/subscriptions/${kSub.id}/skips/${d(2)}`, { token: customer.token })).status).toBe(204);
    expect((await call('GET', `/subscriptions/${kSub.id}`, { token: customer.token })).body.subscription.projectedLastDate).toBe(d(16));
    const again = await call('DELETE', `/subscriptions/${kSub.id}/skips/${d(2)}`, { token: customer.token });
    expect([again.status, errorCode(again)]).toEqual([404, 'SKIP_NOT_FOUND']);
    const locked = await call('DELETE', `/subscriptions/${kSub.id}/skips/${today}`, { token: customer.token });
    expect([locked.status, errorCode(locked)]).toEqual([422, 'DATE_LOCKED']);
  });
});

describe('the nightly job (J1-J5)', () => {
  test('J1-J2: the job creates the day\'s delivery with an address copy, and is safe to run twice', async () => {
    const first = await scheduleDeliveries(start);
    expect(first.created).toBeGreaterThanOrEqual(1);
    kDelivery = await deliveryOf(kSub.id, start);
    expect(kDelivery).toMatchObject({ status: 'scheduled', delivery_line: expect.stringContaining('MG Road') });
    expect((await scheduleDeliveries(start)).created).toBe(0);
  });

  test('J3: a paused day gets no delivery', async () => {
    await scheduleDeliveries(d(7));
    expect(await deliveryOf(kSub.id, d(7))).toBeNull();
  });

  test('J4: once the job has created a delivery, that day can no longer be skipped', async () => {
    const res = await skip(customer.token, kSub.id, { date: start });
    expect([res.status, errorCode(res)]).toEqual([422, 'DATE_LOCKED']);
    expect(res.body.error.details.dates).toEqual([start]);
  });

  test('J5: a day that is not one of the picked weekdays gets nothing', async () => {
    await scheduleDeliveries(d(1));
    expect(await deliveryOf(kSub.id, d(1))).toBeNull();
  });
});

describe('deliveries and completion (W1-W10)', () => {
  let wSub; let past; let rows;
  const mark = (token, id, status) => call('PATCH', `/deliveries/${id}/status`, { token, body: { status } });

  beforeAll(async () => {
    // W-subscription: every weekday except today's, 5 meals. SQL: it started 13 days ago.
    const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].filter((_, i) => i + 1 !== clock.isoWeekday(today));
    wSub = await subscribePaid(customer.token, { planId: await newPlan('W Lunches'), addressId: world.addresses.home, weekdays: days });
    await pool.query('UPDATE subscriptions SET start_date = $2 WHERE id = $1', [wSub.id, clock.addDays(today, -13)]);
    past = [];
    for (let x = clock.addDays(today, -13); x < today; x = clock.addDays(x, 1)) if (clock.isoWeekday(x) !== clock.isoWeekday(today)) past.push(x);
    for (const date of past.slice(0, 6)) await scheduleDeliveries(date);
    rows = (await pool.query('SELECT id, delivery_date FROM subscription_deliveries WHERE subscription_id = $1 ORDER BY delivery_date', [wSub.id])).rows;
  });

  test('W0: six job runs create only five deliveries: the plan has five meals', () => {
    expect(rows).toHaveLength(5);
  });

  test("W1: the kitchen's head-count for a day", async () => {
    const res = await call('GET', `/restaurants/${k.id}/deliveries?date=${rows[0].delivery_date}`, { token: vendor.token });
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({ lunch: 1, dinner: 0 });
    expect(res.body.deliveries.map((x) => x.subscriptionId)).toEqual([wSub.id]);
  });

  test('W2-W3: not before the day, and only the kitchen may mark it', async () => {
    const future = await mark(vendor.token, kDelivery.id, 'delivered');
    expect([future.status, errorCode(future)]).toEqual([422, 'DELIVERY_NOT_DUE']);
    const byCustomer = await mark(customer.token, rows[0].id, 'delivered');
    expect([byCustomer.status, errorCode(byCustomer)]).toEqual([403, 'FORBIDDEN']);
    expect((await mark(stranger.token, rows[0].id, 'delivered')).status).toBe(404);
  });

  test('W4-W6: a missed meal is owed, rescheduled, and the last delivery completes the plan', async () => {
    for (const r of rows.slice(0, 4)) expect((await mark(vendor.token, r.id, 'delivered')).status).toBe(200);
    expect((await mark(vendor.token, rows[4].id, 'missed')).status).toBe(200);
    const afterMiss = (await call('GET', `/subscriptions/${wSub.id}`, { token: customer.token })).body.subscription;
    expect(afterMiss.status).toBe('active');
    expect(afterMiss.progress).toEqual({ delivered: 4, scheduled: 0, missed: 1, remaining: 1 });

    await scheduleDeliveries(past[6]);
    const rescheduled = await deliveryOf(wSub.id, past[6]);
    expect(rescheduled).not.toBeNull();
    const done = await mark(vendor.token, rescheduled.id, 'delivered');
    expect(done.body.subscriptionStatus).toBe('completed');
    const sub = (await call('GET', `/subscriptions/${wSub.id}`, { token: customer.token })).body.subscription;
    expect(sub).toMatchObject({ status: 'completed', endDate: past[6] });
    expect(sub.progress.remaining).toBe(0);

    const twice = await mark(vendor.token, rescheduled.id, 'missed');
    expect([twice.status, errorCode(twice)]).toEqual([409, 'DELIVERY_ALREADY_MARKED']);
  });

  test('W8-W9: a completed plan gets no more deliveries and cannot be skipped', async () => {
    await scheduleDeliveries(past[7]);
    expect(await deliveryOf(wSub.id, past[7])).toBeNull();
    const res = await skip(customer.token, wSub.id, { date: d(4) });
    expect([res.status, errorCode(res)]).toEqual([409, 'SUBSCRIPTION_NOT_ACTIVE']);
  });

  test('W10: cancelling keeps the meal already locked in, stops later ones, refunds the rest', async () => {
    const res = await call('POST', `/subscriptions/${kSub.id}/cancel`, { token: customer.token });
    expect(res.status).toBe(200);
    expect(res.body.subscription.payment.refund).toMatchObject({ amountPaise: 48000, reason: 'Subscription cancelled by customer: 4 of 5 meals unused' });
    await scheduleDeliveries(d(4));
    expect((await deliveryOf(kSub.id, start)).status).toBe('scheduled');
    expect(await deliveryOf(kSub.id, d(4))).toBeNull();
  });
});

describe('auto-cancel and the scheduler lock (X1-X4)', () => {
  let stale; let fresh;
  const cart = () => ({ restaurantId: k.id, addressId: world.addresses.home, items: [{ menuItemId: k.items['Masala Dosa'], quantity: 1 }] });
  const getOrder = async (id) => (await call('GET', `/orders/${id}`, { token: customer.token })).body.order;

  test('X1: an order unconfirmed 15 minutes after payment is cancelled by the system and refunded', async () => {
    stale = (await placePaidOrder(customer.token, cart())).id;
    fresh = (await placePaidOrder(customer.token, cart())).id;
    await pool.query("UPDATE payments SET paid_at = now() - interval '20 minutes' WHERE order_id = $1", [stale]);
    const result = await cancelUnconfirmedOrders();
    expect(result.cancelled).toEqual([stale]);
    const o = await getOrder(stale);
    expect(o.status).toBe('cancelled');
    expect(o.history.at(-1)).toMatchObject({ actor: 'system', changedByUserId: null, note: 'Not confirmed by the restaurant within 15 minutes' });
    expect(o.payment.refund).toMatchObject({ status: 'requested', amountPaise: 12000 });
    expect((await getOrder(fresh)).status).toBe('pending');
  });

  test('X2: the kitchen can no longer confirm it', async () => {
    const res = await call('PATCH', `/orders/${stale}/status`, { token: vendor.token, body: { status: 'confirmed' } });
    expect([res.status, errorCode(res)]).toEqual([409, 'INVALID_TRANSITION']);
    expect(res.body.error.details.allowed).toEqual([]);
  });

  test('X3: history rows: "system" never has a user, a person always does', async () => {
    for (const [actor, user] of [['system', customer.id], ['customer', null]]) {
      await expect(pool.query(
        `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id, actor)
         VALUES ($1, 'pending', 'cancelled', $2, $3)`, [fresh, user, actor],
      )).rejects.toMatchObject({ constraint: 'order_status_history_system_has_no_user' });
    }
  });

  test('X4: a tick does nothing while another session holds the job lock', async () => {
    await pool.query("UPDATE payments SET paid_at = now() - interval '20 minutes' WHERE order_id = $1", [fresh]);
    const holder = await pool.connect();
    try {
      await holder.query('SELECT pg_advisory_lock($1)', [JOB_LOCK_ID]);
      await tick();
      expect((await getOrder(fresh)).status).toBe('pending');
      await holder.query('SELECT pg_advisory_unlock($1)', [JOB_LOCK_ID]);
    } finally {
      holder.release();
    }
    await tick();
    expect((await getOrder(fresh)).status).toBe('cancelled');
  });
});

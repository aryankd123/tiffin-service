// The nightly job: creates one delivery for each active subscription that is due on
// `date`. Safe to run any number of times: UNIQUE (subscription_id, delivery_date) +
// ON CONFLICT DO NOTHING means a second run creates nothing new.
const { withTransaction } = require('../db');
const { isoWeekday } = require('../clock');

async function scheduleDeliveries(date) {
  return withTransaction(async (client) => {
    // Step 1: lock the subscriptions that deliver on this weekday. A customer skipping or
    // pausing at the same moment locks the same row (subscriptionService), so either the skip
    // is committed first and seen below, or it waits and then sees this day as locked.
    const candidates = await client.query(
      `SELECT s.id FROM subscriptions s
       WHERE s.status = 'active' AND s.start_date <= $1::date AND $2::smallint = ANY (s.delivery_weekdays)
       FOR UPDATE`,
      [date, isoWeekday(date)],
    );
    const ids = candidates.rows.map((r) => r.id);
    if (ids.length === 0) return { date, candidates: 0, created: 0 };

    // Step 2: one set-based INSERT for all of them. Delivery details are copied from the
    // address now (snapshot). Left out: skipped days, subscriptions whose meals are all
    // delivered or already scheduled, inactive restaurants, and addresses that moved out
    // of the restaurant's radius. Each left-out meal is simply postponed.
    const inserted = await client.query(
      `INSERT INTO subscription_deliveries
         (subscription_id, restaurant_id, delivery_date, meal_slot,
          contact_name, contact_phone, delivery_line, delivery_location)
       SELECT s.id, r.id, $1::date, s.meal_slot,
              a.contact_name, a.contact_phone,
              concat_ws(', ', a.line1, a.line2, c.name || ' ' || a.postal_code), a.location
       FROM subscriptions s
       JOIN subscription_plans p ON p.id = s.plan_id
       JOIN restaurants r ON r.id = p.restaurant_id
       JOIN addresses a ON a.id = s.address_id
       JOIN cities c ON c.id = a.city_id
       WHERE s.id = ANY ($2::bigint[])
         AND r.is_active
         AND ST_Distance(r.location, a.location) <= r.delivery_radius_m
         AND NOT EXISTS (SELECT 1 FROM subscription_skips k
                         WHERE k.subscription_id = s.id AND k.skip_date = $1::date)
         AND (SELECT count(*) FROM subscription_deliveries d
              WHERE d.subscription_id = s.id AND d.status IN ('scheduled', 'delivered')) < s.meals_total
       ON CONFLICT ON CONSTRAINT subscription_deliveries_one_per_day DO NOTHING
       RETURNING subscription_id`,
      [date, ids],
    );
    return { date, candidates: ids.length, created: inserted.rowCount };
  });
}

module.exports = { scheduleDeliveries };

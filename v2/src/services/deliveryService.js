const { pool, withTransaction } = require('../db');
const { AppError } = require('../errors');
const clock = require('../clock');
const { assertCanManage } = require('./restaurantService');

function toDelivery(row) {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    date: row.delivery_date,
    mealSlot: row.meal_slot,
    status: row.status,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    deliveryLine: row.delivery_line,
  };
}

// The restaurant's head-count for one date: every delivery, plus totals per meal slot.
async function listForRestaurant(user, restaurantId, date) {
  await assertCanManage(pool, user, restaurantId);
  const { rows } = await pool.query(
    `SELECT id, subscription_id, delivery_date, meal_slot, status, contact_name, contact_phone, delivery_line
     FROM subscription_deliveries
     WHERE restaurant_id = $1 AND delivery_date = $2
     ORDER BY meal_slot, id`,
    [restaurantId, date],
  );
  const totals = { lunch: 0, dinner: 0 };
  for (const r of rows) totals[r.meal_slot]++;
  return { date, totals, deliveries: rows.map(toDelivery) };
}

// The restaurant (or an admin) marks a delivery 'delivered' or 'missed'.
// - Compare-and-set from 'scheduled': a delivery is marked once.
// - 'missed' doesn't use up a meal: the nightly job will schedule it again later.
// - The delivery that uses up the last meal completes the subscription.
async function markDelivery(user, deliveryId, status) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT d.id, d.subscription_id, d.delivery_date, d.status, d.restaurant_id,
              r.owner_user_id, s.user_id AS customer_id
       FROM subscription_deliveries d
       JOIN restaurants r ON r.id = d.restaurant_id
       JOIN subscriptions s ON s.id = d.subscription_id
       WHERE d.id = $1`,
      [deliveryId],
    );
    const d = rows[0];
    const isManager = d && (user.role === 'admin' || d.owner_user_id === user.id);
    if (!d || (!isManager && d.customer_id !== user.id)) {
      throw new AppError(404, 'DELIVERY_NOT_FOUND', 'Delivery not found');
    }
    if (!isManager) {
      throw new AppError(403, 'FORBIDDEN', 'Only the restaurant can update a delivery');
    }
    if (d.delivery_date > clock.istNow().date) {
      throw new AppError(422, 'DELIVERY_NOT_DUE', 'This delivery is for a future date');
    }

    // Lock the subscription first, then change the delivery (parent before child, so locks are
    // always taken in the same order and can't deadlock).
    const sub = await client.query(
      'SELECT meals_total, status FROM subscriptions WHERE id = $1 FOR UPDATE',
      [d.subscription_id],
    );
    const updated = await client.query(
      `UPDATE subscription_deliveries SET status = $2, updated_at = now()
       WHERE id = $1 AND status = 'scheduled'`,
      [deliveryId, status],
    );
    if (updated.rowCount === 0) {
      throw new AppError(409, 'DELIVERY_ALREADY_MARKED', `This delivery is already ${d.status}`,
        { status: d.status });
    }

    let subscriptionStatus = sub.rows[0].status;
    if (status === 'delivered') {
      const done = await client.query(
        `SELECT count(*)::int AS n FROM subscription_deliveries
         WHERE subscription_id = $1 AND status = 'delivered'`,
        [d.subscription_id],
      );
      if (done.rows[0].n >= sub.rows[0].meals_total && subscriptionStatus === 'active') {
        await client.query(
          `UPDATE subscriptions SET status = 'completed', end_date = $2
           WHERE id = $1 AND status = 'active'`,
          [d.subscription_id, d.delivery_date],
        );
        subscriptionStatus = 'completed';
      }
    }
    return { delivery: { id: d.id, date: d.delivery_date, status }, subscriptionStatus };
  });
}

module.exports = { listForRestaurant, markDelivery };

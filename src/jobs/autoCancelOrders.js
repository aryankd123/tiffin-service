// An order the restaurant hasn't confirmed within 15 minutes of being paid is cancelled by
// the system and refunded in full. One statement:
// - the UPDATE is a compare-and-set (only rows still 'pending'), so a restaurant confirming at the
//   same moment either wins or loses cleanly;
// - the history rows and the refund requests are written by the same statement, so a cancelled
//   order can't miss either. The refund job sends the refunds afterwards.
// Orders placed before online payment was added have no payment; for them the 15 minutes count from placement.
const { pool } = require('../db');

const CONFIRM_TIMEOUT_MINUTES = 15;
const NOTE = `Not confirmed by the restaurant within ${CONFIRM_TIMEOUT_MINUTES} minutes`;

async function cancelUnconfirmedOrders() {
  const { rows } = await pool.query(
    `WITH stale AS (
       UPDATE orders o SET status = 'cancelled'
       WHERE o.status = 'pending'
         AND COALESCE((SELECT p.paid_at FROM payments p WHERE p.order_id = o.id AND p.status = 'paid'),
                      o.created_at) < now() - make_interval(mins => $1)
       RETURNING o.id
     ),
     history AS (
       INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id, actor, note)
       SELECT id, 'pending', 'cancelled', NULL, 'system', $2 FROM stale
       RETURNING order_id
     ),
     refund AS (
       INSERT INTO refunds (payment_id, amount_paise, reason)
       SELECT p.id, p.amount_paise, $2 FROM stale s JOIN payments p ON p.order_id = s.id AND p.status = 'paid'
       ON CONFLICT (payment_id) DO NOTHING
       RETURNING payment_id
     )
     SELECT (SELECT coalesce(array_agg(order_id ORDER BY order_id), '{}') FROM history) AS cancelled,
            (SELECT count(*)::int FROM refund) AS refunds`,
    [CONFIRM_TIMEOUT_MINUTES, NOTE],
  );
  return { cancelled: rows[0].cancelled, refundsRequested: rows[0].refunds };
}

module.exports = { cancelUnconfirmedOrders, CONFIRM_TIMEOUT_MINUTES };

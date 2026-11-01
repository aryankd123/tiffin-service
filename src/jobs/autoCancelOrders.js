// An order the restaurant hasn't confirmed within 15 minutes is cancelled by the system.
// One statement: the UPDATE is a compare-and-set (only rows still 'pending'), so a restaurant
// confirming at the same moment either wins or loses cleanly; the history rows are written
// in the same statement. (Once orders are paid online, the 15 minutes will count from payment, not placement.)
const { pool } = require('../db');

const CONFIRM_TIMEOUT_MINUTES = 15;
const NOTE = `Not confirmed by the restaurant within ${CONFIRM_TIMEOUT_MINUTES} minutes`;

async function cancelUnconfirmedOrders() {
  const { rows } = await pool.query(
    `WITH stale AS (
       UPDATE orders SET status = 'cancelled'
       WHERE status = 'pending' AND created_at < now() - make_interval(mins => $1)
       RETURNING id
     )
     INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id, actor, note)
     SELECT id, 'pending', 'cancelled', NULL, 'system', $2 FROM stale
     RETURNING order_id`,
    [CONFIRM_TIMEOUT_MINUTES, NOTE],
  );
  return rows.map((r) => r.order_id);
}

module.exports = { cancelUnconfirmedOrders, CONFIRM_TIMEOUT_MINUTES };

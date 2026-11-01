// Paying for orders: checkout, verification, the status check that catches payments
// the browser never reported, expiry, and refunds.
// Rule for every gateway call: never inside a database transaction. A slow gateway must not hold
// a pooled connection or row locks, and an HTTP call can't be rolled back anyway.
const { pool, withTransaction } = require('../db');
const { AppError } = require('../errors');
const logger = require('../logger');
const { gateway } = require('../payments/gateway');

const PAYMENT_WINDOW_MINUTES = 15;
const MAX_REFUND_ATTEMPTS = 5;

const gatewayDown = (err) => {
  logger.warn({ reason: String(err.message).slice(0, 160) }, 'payment gateway call failed');
  return new AppError(502, 'PAYMENT_GATEWAY_UNAVAILABLE', 'The payment provider could not be reached; try again');
};

function toPayment(p) {
  return {
    id: p.id,
    provider: p.provider,
    status: p.status,
    amountPaise: p.amount_paise,
    currency: p.currency,
    // What the browser needs to open the checkout (both public; the key secret never leaves the server).
    keyId: gateway.keyId,
    gatewayOrderId: p.gateway_order_id,
    paidAt: p.paid_at,
  };
}

async function loadOrderForCustomer(db, user, orderId) {
  const { rows } = await db.query('SELECT id, user_id, status, total_paise FROM orders WHERE id = $1', [orderId]);
  const o = rows[0];
  if (!o || o.user_id !== user.id) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
  return o;
}

// Starts (or returns) the checkout for an order. Safe to call any number of times: the partial
// unique index allows one payment per order; a concurrent second call keeps the first row.
async function checkoutForOrder(user, orderId) {
  const order = await loadOrderForCustomer(pool, user, orderId);
  const existing = await pool.query('SELECT * FROM payments WHERE order_id = $1', [orderId]);
  if (existing.rows[0]) return toPayment(existing.rows[0]);
  if (order.status !== 'awaiting_payment') {
    throw new AppError(409, 'PAYMENT_NOT_NEEDED', `This order is ${order.status}`, { status: order.status });
  }

  let g;
  try {
    g = await gateway.createOrder({
      amountPaise: order.total_paise, // the DB total, never a client number
      receipt: `order_${order.id}`,
      notes: { tiffin_order_id: String(order.id) },
    });
  } catch (err) {
    throw gatewayDown(err);
  }
  await pool.query(
    `INSERT INTO payments (order_id, provider, gateway_order_id, amount_paise)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (order_id) WHERE order_id IS NOT NULL DO NOTHING`,
    [order.id, gateway.name, g.gatewayOrderId, order.total_paise],
  );
  const { rows } = await pool.query('SELECT * FROM payments WHERE order_id = $1', [orderId]);
  return toPayment(rows[0]);
}

// Records a refund to be sent by the refund job. ON CONFLICT: a payment is refunded at most once,
// whatever path asks for it.
async function requestRefund(client, paymentId, amountPaise, reason) {
  const { rowCount } = await client.query(
    `INSERT INTO refunds (payment_id, amount_paise, reason) VALUES ($1, $2, $3)
     ON CONFLICT (payment_id) DO NOTHING`,
    [paymentId, amountPaise, reason],
  );
  return rowCount === 1;
}

// The single place where an order payment becomes 'paid' (from the checkout signature, the status
// check or, in 6B, a webhook). Compare-and-set on both rows, so repeating it is harmless.
// A payment that arrives after the order expired or was cancelled is refunded in full.
async function markOrderPaid(paymentId, gatewayPaymentId, actor, userId) {
  return withTransaction(async (client) => {
    const paid = await client.query(
      `UPDATE payments SET status = 'paid', paid_at = now(), gateway_payment_id = $2
       WHERE id = $1 AND status IN ('created', 'expired')
       RETURNING order_id, amount_paise`,
      [paymentId, gatewayPaymentId],
    );
    if (paid.rowCount === 0) return { changed: false }; // already paid: nothing to do
    const { order_id: orderId, amount_paise: amount } = paid.rows[0];

    const moved = await client.query(
      `UPDATE orders SET status = 'pending' WHERE id = $1 AND status = 'awaiting_payment'`,
      [orderId],
    );
    if (moved.rowCount === 1) {
      await client.query(
        `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id, actor, note)
         VALUES ($1, 'awaiting_payment', 'pending', $2, $3, 'Payment received')`,
        [orderId, userId, actor],
      );
      return { changed: true, orderId, late: false };
    }
    await requestRefund(client, paymentId, amount, 'Payment arrived after the order was closed');
    return { changed: true, orderId, late: true };
  });
}

// The browser reports a finished checkout. The signature proves Razorpay saw this payment for
// this gateway order (whose amount the server set). If the account doesn't auto-capture,
// an 'authorized' payment is captured here.
async function verifyOrderPayment(user, orderId, { gatewayPaymentId, signature }) {
  await loadOrderForCustomer(pool, user, orderId);
  const { rows } = await pool.query('SELECT * FROM payments WHERE order_id = $1', [orderId]);
  const payment = rows[0];
  if (!payment) throw new AppError(409, 'CHECKOUT_NOT_STARTED', 'Start the checkout first');
  if (payment.status === 'paid') {
    if (payment.gateway_payment_id === gatewayPaymentId) return toPayment(payment); // a retry
    throw new AppError(409, 'ALREADY_PAID', 'This order is already paid');
  }
  if (!gateway.verifyCheckout(payment.gateway_order_id, gatewayPaymentId, signature)) {
    throw new AppError(400, 'INVALID_PAYMENT_SIGNATURE', 'The payment could not be verified');
  }
  try {
    const p = (await gateway.fetchPayments(payment.gateway_order_id)).find((x) => x.id === gatewayPaymentId);
    if (p?.status === 'authorized') await gateway.capture(gatewayPaymentId, payment.amount_paise);
  } catch (err) {
    throw gatewayDown(err);
  }
  await markOrderPaid(payment.id, gatewayPaymentId, 'customer', user.id);
  const after = await pool.query('SELECT * FROM payments WHERE id = $1', [payment.id]);
  return toPayment(after.rows[0]);
}

// Job: for every unpaid order payment, ask the gateway. Paid → mark paid (the
// browser may have closed before verifying). Unpaid after 15 minutes → expire order and payment.
async function reconcileAndExpireOrders() {
  const { rows } = await pool.query(
    `SELECT p.id, p.gateway_order_id, p.amount_paise, o.id AS order_id,
            p.created_at < now() - make_interval(mins => $1) AS overdue
     FROM payments p JOIN orders o ON o.id = p.order_id
     WHERE p.status = 'created' AND o.status = 'awaiting_payment'
     ORDER BY p.id LIMIT 200`,
    [PAYMENT_WINDOW_MINUTES],
  );
  const result = { checked: rows.length, paid: 0, expired: 0, errors: 0 };
  for (const p of rows) {
    let captured;
    try {
      const payments = await gateway.fetchPayments(p.gateway_order_id);
      captured = payments.find((x) => x.status === 'captured');
      const authorized = payments.find((x) => x.status === 'authorized');
      if (!captured && authorized) {
        await gateway.capture(authorized.id, p.amount_paise);
        captured = authorized;
      }
    } catch (err) {
      result.errors++;
      logger.warn({ reason: String(err.message).slice(0, 160), paymentId: p.id }, 'payment status check failed');
      continue; // try again next tick; don't expire what we couldn't check
    }
    if (captured) {
      if ((await markOrderPaid(p.id, captured.id, 'system', null)).changed) result.paid++;
    } else if (p.overdue) {
      await withTransaction(async (client) => {
        const expired = await client.query(
          `UPDATE orders SET status = 'expired' WHERE id = $1 AND status = 'awaiting_payment'`, [p.order_id]);
        if (expired.rowCount === 1) {
          await client.query(
            `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id, actor, note)
             VALUES ($1, 'awaiting_payment', 'expired', NULL, 'system', $2)`,
            [p.order_id, `Not paid within ${PAYMENT_WINDOW_MINUTES} minutes`]);
          await client.query(`UPDATE payments SET status = 'expired' WHERE id = $1 AND status = 'created'`, [p.id]);
          result.expired++;
        }
      });
    }
  }
  return result;
}

// Job: sends requested refunds to the gateway. Before each call it asks the gateway whether
// this refund already exists (tagged with our refund id), so a crash between "gateway refunded"
// and "we saved it" can't cause a second refund. Failures are retried up to 5 times.
async function processRefunds() {
  const { rows } = await pool.query(
    `SELECT r.id, r.amount_paise, r.attempts, p.gateway_payment_id
     FROM refunds r JOIN payments p ON p.id = r.payment_id
     WHERE r.status = 'requested' ORDER BY r.id LIMIT 50`,
  );
  const result = { checked: rows.length, processed: 0, failed: 0, retrying: 0 };
  for (const r of rows) {
    try {
      const done = (await gateway.findRefund(r.gateway_payment_id, r.id))
        ?? (await gateway.refund(r.gateway_payment_id, r.amount_paise, { tiffin_refund_id: String(r.id) }));
      await pool.query(
        `UPDATE refunds SET status = 'processed', gateway_refund_id = $2, processed_at = now(),
                            attempts = attempts + 1, last_error = NULL
         WHERE id = $1 AND status = 'requested'`,
        [r.id, done.gatewayRefundId],
      );
      result.processed++;
    } catch (err) {
      const giveUp = r.attempts + 1 >= MAX_REFUND_ATTEMPTS;
      await pool.query(
        `UPDATE refunds SET attempts = attempts + 1, last_error = $2, status = CASE WHEN $3 THEN 'failed' ELSE status END
         WHERE id = $1 AND status = 'requested'`,
        [r.id, String(err.message).slice(0, 200), giveUp],
      );
      if (giveUp) result.failed++; else result.retrying++;
      logger.warn({ refundId: r.id, reason: String(err.message).slice(0, 160) }, 'refund attempt failed');
    }
  }
  return result;
}

// The payment and refund of an order, for GET /orders/:id.
async function paymentSummaryForOrder(db, orderId) {
  const { rows } = await db.query(
    `SELECT p.status, p.amount_paise, p.paid_at, p.provider,
            r.status AS refund_status, r.amount_paise AS refund_paise, r.reason AS refund_reason
     FROM payments p LEFT JOIN refunds r ON r.payment_id = p.id
     WHERE p.order_id = $1`,
    [orderId],
  );
  const p = rows[0];
  if (!p) return null;
  return {
    status: p.status,
    provider: p.provider,
    amountPaise: p.amount_paise,
    paidAt: p.paid_at,
    refund: p.refund_status ? { status: p.refund_status, amountPaise: p.refund_paise, reason: p.refund_reason } : null,
  };
}

module.exports = {
  checkoutForOrder,
  verifyOrderPayment,
  markOrderPaid,
  requestRefund,
  reconcileAndExpireOrders,
  processRefunds,
  paymentSummaryForOrder,
  PAYMENT_WINDOW_MINUTES,
};

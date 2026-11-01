// Razorpay webhooks: Razorpay POSTs an event to a public URL when a payment changes.
// - The body is signed with the webhook secret (HMAC-SHA256 over the raw bytes), so only Razorpay
//   can produce a valid one. A signed event is still cross-checked with the gateway before use.
// - Processing is idempotent (markPaid is compare-and-set), so Razorpay's retries and duplicate
//   deliveries are harmless. The event log only saves repeated work and keeps an audit trail.
// - Any non-2xx answer makes Razorpay retry later, so our own failures (database, gateway) are
//   answered with an error on purpose.
const { pool } = require('../db');
const { AppError } = require('../errors');
const logger = require('../logger');
const { gateway } = require('../payments/gateway');
const { markPaid } = require('./paymentService');

// The events that can mean "money received". Everything else is acknowledged and ignored.
const PAYMENT_EVENTS = new Set(['payment.authorized', 'payment.captured', 'order.paid']);

async function processEvent(event) {
  if (!PAYMENT_EVENTS.has(event.event)) return 'ignored';
  const entity = event.payload?.payment?.entity;
  if (typeof entity?.id !== 'string' || typeof entity.order_id !== 'string') return 'ignored';

  const { rows } = await pool.query(
    'SELECT id, amount_paise, status, gateway_payment_id FROM payments WHERE gateway_order_id = $1',
    [entity.order_id],
  );
  const payment = rows[0];
  if (!payment) return 'unknown_order'; // e.g. another app on the same Razorpay account
  if (entity.amount !== payment.amount_paise) {
    logger.warn({ paymentId: payment.id }, 'webhook amount does not match the payment');
    return 'amount_mismatch';
  }
  if (payment.status === 'paid') {
    if (payment.gateway_payment_id === entity.id) return 'already_paid';
    // A second successful payment on the same gateway order: not refunded automatically.
    logger.warn({ paymentId: payment.id }, 'second payment on an already paid gateway order');
    return 'second_payment';
  }

  // The event says what happened; the gateway says what is true now (it may have been captured
  // since, or the event may be stale). The same check the status job makes.
  try {
    const current = (await gateway.fetchPayments(entity.order_id)).find((p) => p.id === entity.id);
    if (current?.status === 'authorized') {
      await gateway.capture(entity.id, payment.amount_paise);
    } else if (current?.status !== 'captured') {
      return 'not_captured';
    }
  } catch (err) {
    logger.warn({ reason: String(err.message).slice(0, 160) }, 'webhook: gateway check failed');
    throw new AppError(502, 'PAYMENT_GATEWAY_UNAVAILABLE', 'Could not check the payment; retry later');
  }
  const result = await markPaid(payment.id, entity.id, 'system', null);
  if (!result.changed) return 'already_paid';
  return result.late ? 'paid_late_refund' : 'paid';
}

async function handleWebhook({ rawBody, signature, eventId }) {
  if (!Buffer.isBuffer(rawBody) || !gateway.verifyWebhook(rawBody, signature)) {
    throw new AppError(400, 'INVALID_WEBHOOK_SIGNATURE', 'The webhook signature could not be verified');
  }
  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new AppError(400, 'INVALID_WEBHOOK_BODY', 'The webhook body is not JSON');
  }

  if (eventId) {
    const seen = await pool.query('SELECT outcome FROM payment_webhook_events WHERE event_id = $1', [eventId]);
    if (seen.rows[0]) return { outcome: 'duplicate', firstOutcome: seen.rows[0].outcome };
  }
  const outcome = await processEvent(event);
  // Recorded only after processing succeeded: if processing throws, Razorpay's retry is processed
  // again instead of being mistaken for a duplicate.
  if (eventId) {
    await pool.query(
      `INSERT INTO payment_webhook_events (event_id, event, gateway_payment_id, outcome)
       VALUES ($1, $2, $3, $4) ON CONFLICT (event_id) DO NOTHING`,
      [eventId, String(event.event).slice(0, 100), event.payload?.payment?.entity?.id ?? null, outcome],
    );
  }
  return { outcome };
}

module.exports = { handleWebhook };

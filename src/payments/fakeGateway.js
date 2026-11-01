// An offline stand-in for Razorpay with the same interface, for development and tests.
// It keeps its state in memory, so it forgets everything when the server restarts.
// Never allowed in production (config refuses it).
const crypto = require('node:crypto');
const { hmacHex, checkoutSignatureValid, webhookSignatureValid } = require('./signatures');

const FAKE_KEY_SECRET = 'fake-gateway-key-secret-not-a-real-secret';
const FAKE_WEBHOOK_SECRET = 'fake-gateway-webhook-secret-not-a-real-secret';

function createFakeGateway() {
  const orders = new Map();  // gatewayOrderId → { amountPaise, payments: [] }
  const refunds = new Map(); // gatewayPaymentId → [{ gatewayRefundId, tiffinRefundId, amountPaise }]
  const newId = (prefix) => `${prefix}_fake_${crypto.randomBytes(7).toString('hex')}`;

  return {
    name: 'fake',
    keyId: 'rzp_test_fake',

    async createOrder({ amountPaise }) {
      const gatewayOrderId = newId('order');
      orders.set(gatewayOrderId, { amountPaise, payments: [] });
      return { gatewayOrderId, amountPaise, currency: 'INR' };
    },

    async fetchPayments(gatewayOrderId) {
      return (orders.get(gatewayOrderId)?.payments ?? []).map((p) => ({ ...p }));
    },

    async capture(gatewayPaymentId) {
      for (const o of orders.values()) {
        const p = o.payments.find((x) => x.id === gatewayPaymentId);
        if (p) p.status = 'captured';
      }
    },

    async refund(gatewayPaymentId, amountPaise, notes) {
      const gatewayRefundId = newId('rfnd');
      const list = refunds.get(gatewayPaymentId) ?? [];
      list.push({ gatewayRefundId, tiffinRefundId: notes?.tiffin_refund_id, amountPaise });
      refunds.set(gatewayPaymentId, list);
      return { gatewayRefundId, status: 'processed' };
    },

    async findRefund(gatewayPaymentId, tiffinRefundId) {
      const hit = (refunds.get(gatewayPaymentId) ?? []).find((r) => r.tiffinRefundId === String(tiffinRefundId));
      return hit ? { gatewayRefundId: hit.gatewayRefundId, status: 'processed' } : null;
    },

    verifyCheckout(gatewayOrderId, gatewayPaymentId, signature) {
      return checkoutSignatureValid(FAKE_KEY_SECRET, gatewayOrderId, gatewayPaymentId, signature);
    },

    verifyWebhook(rawBody, signature) {
      return webhookSignatureValid(FAKE_WEBHOOK_SECRET, rawBody, signature);
    },

    // --- Only the fake has these: they play the part of the customer's browser and of Razorpay.

    // The customer pays in the checkout window: returns what Razorpay's checkout hands back.
    simulatePayment(gatewayOrderId, { status = 'captured' } = {}) {
      const order = orders.get(gatewayOrderId);
      if (!order) return null;
      const id = newId('pay');
      order.payments.push({ id, status, amountPaise: order.amountPaise });
      return { gatewayPaymentId: id, signature: hmacHex(FAKE_KEY_SECRET, `${gatewayOrderId}|${id}`) };
    },

    // Signs a webhook body the way Razorpay would.
    signWebhook(rawBody) {
      return hmacHex(FAKE_WEBHOOK_SECRET, rawBody);
    },
  };
}

module.exports = { createFakeGateway };

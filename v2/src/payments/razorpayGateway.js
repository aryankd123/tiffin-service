// Razorpay over its REST API (no SDK): orders, payments, capture, refunds.
// Amounts are integer paise, as in Tiffin. Test-mode keys never move real money.
const { checkoutSignatureValid, webhookSignatureValid } = require('./signatures');

const BASE = 'https://api.razorpay.com/v1';

class GatewayError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
  }
}

function createRazorpayGateway({ keyId, keySecret, webhookSecret }) {
  const auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;

  async function api(method, path, body) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { authorization: auth, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000), // never hang a request or job on the gateway
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Only Razorpay's description: never the request, which carries the key in its headers.
      throw new GatewayError(`razorpay ${method} ${path.split('/')[1]}: ${json.error?.description ?? res.status}`, res.status);
    }
    return json;
  }

  return {
    name: 'razorpay',
    keyId, // public: the browser checkout needs it

    async createOrder({ amountPaise, receipt, notes }) {
      const o = await api('POST', '/orders', { amount: amountPaise, currency: 'INR', receipt, notes });
      return { gatewayOrderId: o.id, amountPaise: o.amount, currency: o.currency };
    },

    // The payments made against a gateway order. 'captured' = money taken; 'authorized' = approved,
    // waiting for capture (depends on the account's auto-capture setting).
    async fetchPayments(gatewayOrderId) {
      const r = await api('GET', `/orders/${encodeURIComponent(gatewayOrderId)}/payments`);
      return (r.items ?? []).map((p) => ({ id: p.id, status: p.status, amountPaise: p.amount }));
    },

    async capture(gatewayPaymentId, amountPaise) {
      await api('POST', `/payments/${encodeURIComponent(gatewayPaymentId)}/capture`, { amount: amountPaise, currency: 'INR' });
    },

    async refund(gatewayPaymentId, amountPaise, notes) {
      const r = await api('POST', `/payments/${encodeURIComponent(gatewayPaymentId)}/refund`, { amount: amountPaise, notes });
      return { gatewayRefundId: r.id, status: r.status };
    },

    // Refunds already made on a payment, to avoid refunding twice after a lost response.
    async findRefund(gatewayPaymentId, tiffinRefundId) {
      const r = await api('GET', `/payments/${encodeURIComponent(gatewayPaymentId)}/refunds`);
      const hit = (r.items ?? []).find((x) => x.notes?.tiffin_refund_id === String(tiffinRefundId));
      return hit ? { gatewayRefundId: hit.id, status: hit.status } : null;
    },

    verifyCheckout(gatewayOrderId, gatewayPaymentId, signature) {
      return checkoutSignatureValid(keySecret, gatewayOrderId, gatewayPaymentId, signature);
    },

    verifyWebhook(rawBody, signature) {
      return Boolean(webhookSecret) && webhookSignatureValid(webhookSecret, rawBody, signature);
    },
  };
}

module.exports = { createRazorpayGateway, GatewayError };

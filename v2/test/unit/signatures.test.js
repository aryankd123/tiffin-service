// HMAC signatures and the offline fake gateway.
const { hmacHex, checkoutSignatureValid, webhookSignatureValid } = require('../../src/payments/signatures');
const { createFakeGateway } = require('../../src/payments/fakeGateway');

describe('hmacHex', () => {
  test('matches the published HMAC-SHA256 test vector', () => {
    expect(hmacHex('key', 'The quick brown fox jumps over the lazy dog'))
      .toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
  });
});

describe('checkout signature: HMAC of "<order id>|<payment id>"', () => {
  const secret = 'test-secret';
  const good = hmacHex(secret, 'order_1|pay_1');

  test('accepts the right signature', () => {
    expect(checkoutSignatureValid(secret, 'order_1', 'pay_1', good)).toBe(true);
  });

  test('rejects another secret, another payment, or another order (Y5, Y6)', () => {
    expect(checkoutSignatureValid('guessed', 'order_1', 'pay_1', good)).toBe(false);
    expect(checkoutSignatureValid(secret, 'order_1', 'pay_2', good)).toBe(false);
    expect(checkoutSignatureValid(secret, 'order_2', 'pay_1', good)).toBe(false);
  });

  test('rejects a missing, short or non-string signature without throwing', () => {
    expect(checkoutSignatureValid(secret, 'order_1', 'pay_1', undefined)).toBe(false);
    expect(checkoutSignatureValid(secret, 'order_1', 'pay_1', good.slice(0, 63))).toBe(false);
    expect(checkoutSignatureValid(secret, 'order_1', 'pay_1', 12345)).toBe(false);
  });
});

describe('webhook signature: HMAC of the raw body', () => {
  const secret = 'webhook-secret';
  const body = Buffer.from('{"event":"payment.captured","amount":18000}');

  test('accepts the exact bytes it was made for', () => {
    expect(webhookSignatureValid(secret, body, hmacHex(secret, body))).toBe(true);
  });

  test('rejects the same JSON with one character changed (G6)', () => {
    const tampered = Buffer.from('{"event":"payment.captured","amount":10000}');
    expect(webhookSignatureValid(secret, tampered, hmacHex(secret, body))).toBe(false);
  });

  test('rejects the same JSON re-serialised with different spacing', () => {
    const respaced = Buffer.from('{"event": "payment.captured", "amount": 18000}');
    expect(webhookSignatureValid(secret, respaced, hmacHex(secret, body))).toBe(false);
  });
});

describe('fake gateway', () => {
  test('a simulated payment carries a signature the gateway accepts', async () => {
    const g = createFakeGateway();
    const { gatewayOrderId } = await g.createOrder({ amountPaise: 33000 });
    const paid = g.simulatePayment(gatewayOrderId);
    expect(g.verifyCheckout(gatewayOrderId, paid.gatewayPaymentId, paid.signature)).toBe(true);
    expect(g.verifyCheckout(gatewayOrderId, 'pay_fake_other', paid.signature)).toBe(false);
    expect(await g.fetchPayments(gatewayOrderId)).toEqual([
      { id: paid.gatewayPaymentId, status: 'captured', amountPaise: 33000 },
    ]);
  });

  test('an authorized payment becomes captured when captured', async () => {
    const g = createFakeGateway();
    const { gatewayOrderId } = await g.createOrder({ amountPaise: 100 });
    const paid = g.simulatePayment(gatewayOrderId, { status: 'authorized' });
    await g.capture(paid.gatewayPaymentId);
    expect((await g.fetchPayments(gatewayOrderId))[0].status).toBe('captured');
  });

  test('refunds can be found again by Tiffin\'s refund id', async () => {
    const g = createFakeGateway();
    const r = await g.refund('pay_x', 500, { tiffin_refund_id: '7' });
    expect(await g.findRefund('pay_x', 7)).toEqual({ gatewayRefundId: r.gatewayRefundId, status: 'processed' });
    expect(await g.findRefund('pay_x', 8)).toBeNull();
  });

  test('webhooks it signs verify, others do not', () => {
    const g = createFakeGateway();
    const raw = Buffer.from('{"event":"order.paid"}');
    expect(g.verifyWebhook(raw, g.signWebhook(raw))).toBe(true);
    expect(g.verifyWebhook(raw, hmacHex('guessed', raw))).toBe(false);
  });
});

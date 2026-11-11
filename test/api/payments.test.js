// Paying for orders: checkout, signature verification, the status-check job, expiry, late
// payments, cancellations with refunds, the refund job's retries and crash safety, and the
// database's payment rules (Y1-Y9, Z1-Z3, E1-E3, F1-F8, H1-H2).
const { pool } = require('../../src/db');
const { gateway } = require('../../src/payments/gateway');
const { hmacHex } = require('../../src/payments/signatures');
const paymentService = require('../../src/services/paymentService');
const { cancelUnconfirmedOrders } = require('../../src/jobs/autoCancelOrders');
const { call, login, registerUser, errorCode, placeOrder, pay, placePaidOrder } = require('../helpers/api');
const { resetWorld } = require('../helpers/world');

let world; let customer; let vendor; let stranger; let k; let cart;
const getOrder = async (id) => (await call('GET', `/orders/${id}`, { token: customer.token })).body.order;
const verify = (id, body) => call('POST', `/orders/${id}/payment/verify`, { token: customer.token, body });
const refundRow = async (orderId) => (await pool.query(
  'SELECT r.* FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE p.order_id = $1', [orderId])).rows[0];

beforeAll(async () => {
  world = await resetWorld();
  customer = await login(world.users.customer.email);
  vendor = await login(world.users.vendor.email);
  stranger = await registerUser('payments.stranger');
  k = world.restaurants.koramangala;
  cart = { restaurantId: k.id, addressId: world.addresses.home, items: [{ menuItemId: k.items['Veg Thali'], quantity: 2 }] };
});

afterEach(() => jest.restoreAllMocks());

describe('checkout and verification (Y1-Y9)', () => {
  let order; let payment; let paid;

  test('Y1-Y2: placing an order starts a checkout for the database total; repeating it returns the same one', async () => {
    const res = await placeOrder(customer.token, cart);
    ({ order, payment } = res.body);
    expect(order).toMatchObject({ status: 'awaiting_payment', totalPaise: 33000 });
    expect(payment).toMatchObject({ provider: 'fake', status: 'created', amountPaise: 33000, keyId: 'rzp_test_fake' });
    const again = await call('POST', `/orders/${order.id}/payment`, { token: customer.token });
    expect(again.body.payment.gatewayOrderId).toBe(payment.gatewayOrderId);
  });

  test("Y3-Y4: the kitchen can't see an unpaid order; a stranger can't start its checkout", async () => {
    expect((await call('GET', `/orders/${order.id}`, { token: vendor.token })).status).toBe(404);
    expect((await call('PATCH', `/orders/${order.id}/status`, { token: vendor.token, body: { status: 'confirmed' } })).status).toBe(404);
    const inbox = await call('GET', `/restaurants/${k.id}/orders?limit=50`, { token: vendor.token });
    expect(inbox.body.orders.map((o) => o.id)).not.toContain(order.id);
    expect((await call('POST', `/orders/${order.id}/payment`, { token: stranger.token })).status).toBe(404);
  });

  test('Y5-Y6: a forged signature, or a real signature with another payment id, is refused', async () => {
    paid = gateway.simulatePayment(payment.gatewayOrderId);
    const forged = hmacHex('a-guessed-secret', `${payment.gatewayOrderId}|${paid.gatewayPaymentId}`);
    const a = await verify(order.id, { gatewayPaymentId: paid.gatewayPaymentId, signature: forged });
    expect([a.status, errorCode(a)]).toEqual([400, 'INVALID_PAYMENT_SIGNATURE']);
    const b = await verify(order.id, { gatewayPaymentId: 'pay_fake_someoneelse', signature: paid.signature });
    expect([b.status, errorCode(b)]).toEqual([400, 'INVALID_PAYMENT_SIGNATURE']);
  });

  test('Y7-Y8: the real signature pays the order; repeating it changes nothing', async () => {
    const res = await verify(order.id, paid);
    expect(res.status).toBe(200);
    expect(res.body.payment.status).toBe('paid');
    expect(res.body.order.status).toBe('pending');
    expect(res.body.order.history.at(-1).note).toBe('Payment received');
    const again = await verify(order.id, paid);
    expect(again.status).toBe(200);
    expect(again.body.order.status).toBe('pending');
    const inbox = await call('GET', `/restaurants/${k.id}/orders?limit=50`, { token: vendor.token });
    expect(inbox.body.orders.map((o) => o.id)).toContain(order.id);
  });

  test('Y9: a second, different payment on a paid order is refused', async () => {
    const second = gateway.simulatePayment(payment.gatewayOrderId);
    const res = await verify(order.id, second);
    expect([res.status, errorCode(res)]).toEqual([409, 'ALREADY_PAID']);
  });
});

describe('the status check and expiry (Z1-Z3, E1-E3)', () => {
  test('Z1: paid at the gateway but never reported: the job finds it', async () => {
    const { order, payment } = (await placeOrder(customer.token, cart)).body;
    gateway.simulatePayment(payment.gatewayOrderId);
    expect((await getOrder(order.id)).status).toBe('awaiting_payment');
    const result = await paymentService.reconcileAndExpire();
    expect(result.paid).toBe(1);
    const o = await getOrder(order.id);
    expect(o.status).toBe('pending');
    expect(o.history.at(-1).actor).toBe('system');
  });

  test('Z2: only authorised: the job captures it first', async () => {
    const { order, payment } = (await placeOrder(customer.token, cart)).body;
    gateway.simulatePayment(payment.gatewayOrderId, { status: 'authorized' });
    await paymentService.reconcileAndExpire();
    expect((await getOrder(order.id)).status).toBe('pending');
    expect((await gateway.fetchPayments(payment.gatewayOrderId))[0].status).toBe('captured');
  });

  let unpaid;
  test('Z3: unpaid and new: left alone', async () => {
    unpaid = (await placeOrder(customer.token, cart)).body;
    await paymentService.reconcileAndExpire();
    expect((await getOrder(unpaid.order.id)).status).toBe('awaiting_payment');
  });

  test('E1: unpaid after 15 minutes: expired, with a reason', async () => {
    await pool.query("UPDATE payments SET created_at = now() - interval '16 minutes' WHERE order_id = $1", [unpaid.order.id]);
    const result = await paymentService.reconcileAndExpire();
    expect(result.expired).toBe(1);
    const o = await getOrder(unpaid.order.id);
    expect(o.status).toBe('expired');
    expect(o.payment.status).toBe('expired');
    expect(o.history.at(-1)).toMatchObject({ actor: 'system', note: 'Not paid within 15 minutes' });
  });

  test('E2-E3: a payment after expiry is accepted and refunded in full; the order stays closed', async () => {
    const late = gateway.simulatePayment(unpaid.payment.gatewayOrderId);
    expect((await verify(unpaid.order.id, late)).status).toBe(200);
    const o = await getOrder(unpaid.order.id);
    expect(o.status).toBe('expired');
    expect(o.payment.status).toBe('paid');
    expect(o.payment.refund).toMatchObject({ status: 'requested', amountPaise: 33000, reason: 'Payment arrived after the order was closed' });
    const res = await call('POST', `/orders/${unpaid.order.id}/cancel`, { token: customer.token });
    expect([res.status, errorCode(res)]).toEqual([409, 'CANCEL_NOT_ALLOWED']);
  });
});

describe('cancellations and refunds (F1-F8)', () => {
  let f2; let f3;

  test('F1: cancelling an unpaid order refunds nothing', async () => {
    const { order } = (await placeOrder(customer.token, cart)).body;
    const res = await call('POST', `/orders/${order.id}/cancel`, { token: customer.token });
    expect(res.body.order.status).toBe('cancelled');
    expect(res.body.order.payment.refund).toBeNull();
  });

  test('F2-F3: every cancelled paid order is refunded in full, whoever cancels', async () => {
    f2 = await placePaidOrder(customer.token, cart);
    const byCustomer = await call('POST', `/orders/${f2.id}/cancel`, { token: customer.token, body: { reason: 'Changed my mind' } });
    expect(byCustomer.body.order.payment.refund).toMatchObject({ status: 'requested', amountPaise: 33000, reason: 'Order cancelled by customer' });
    f3 = await placePaidOrder(customer.token, cart);
    await call('PATCH', `/orders/${f3.id}/status`, { token: vendor.token, body: { status: 'confirmed' } });
    const byKitchen = await call('POST', `/orders/${f3.id}/cancel`, { token: vendor.token, body: { reason: 'Kitchen closed' } });
    expect(byKitchen.body.order.payment.refund).toMatchObject({ status: 'requested', reason: 'Order cancelled by restaurant' });
  });

  test('F4-F5: the refund job sends them once', async () => {
    expect(await paymentService.processRefunds()).toMatchObject({ checked: 3, processed: 3 }); // E2, F2, F3
    expect((await getOrder(f2.id)).payment.refund.status).toBe('processed');
    expect(await refundRow(f2.id)).toMatchObject({ attempts: 1, gateway_refund_id: expect.stringMatching(/^rfnd_fake_/) });
    expect((await paymentService.processRefunds()).checked).toBe(0);
  });

  test('F6: the database refuses a second refund, a paid payment without an id, and an illegal jump', async () => {
    await expect(pool.query(
      "INSERT INTO refunds (payment_id, amount_paise, reason) SELECT id, 100, 'again' FROM payments WHERE order_id = $1", [f2.id],
    )).rejects.toMatchObject({ constraint: 'refunds_payment_id_key' });
    const fresh = (await placeOrder(customer.token, cart)).body.order;
    await expect(pool.query(
      "UPDATE payments SET status = 'paid', paid_at = now(), gateway_payment_id = NULL WHERE order_id = $1", [fresh.id],
    )).rejects.toMatchObject({ constraint: 'payments_paid_consistent' });
    await expect(pool.query("UPDATE orders SET status = 'delivered' WHERE id = $1", [fresh.id]))
      .rejects.toMatchObject({ constraint: 'orders_status_transition' });
  });

  test('F7: a failing gateway: the refund is retried, then marked failed after 5 attempts', async () => {
    const o = await placePaidOrder(customer.token, cart);
    await call('POST', `/orders/${o.id}/cancel`, { token: customer.token });
    jest.spyOn(gateway, 'refund').mockRejectedValue(new Error('gateway down'));
    for (let i = 1; i <= 4; i++) expect(await paymentService.processRefunds()).toMatchObject({ checked: 1, retrying: 1 });
    expect(await paymentService.processRefunds()).toMatchObject({ checked: 1, failed: 1 });
    expect(await refundRow(o.id)).toMatchObject({ status: 'failed', attempts: 5, last_error: 'gateway down' });
    expect((await paymentService.processRefunds()).checked).toBe(0); // a failed refund waits for a person
  });

  test('F8: a refund sent just before a crash is found at the gateway, not sent twice', async () => {
    const o = await placePaidOrder(customer.token, cart);
    await call('POST', `/orders/${o.id}/cancel`, { token: customer.token });
    const row = await refundRow(o.id);
    const { rows } = await pool.query('SELECT gateway_payment_id FROM payments WHERE order_id = $1', [o.id]);
    // The earlier run sent it (tagged with our refund id) and crashed before saving the result.
    const sent = await gateway.refund(rows[0].gateway_payment_id, row.amount_paise, { tiffin_refund_id: String(row.id) });
    const refundSpy = jest.spyOn(gateway, 'refund');
    expect(await paymentService.processRefunds()).toMatchObject({ checked: 1, processed: 1 });
    expect(refundSpy).not.toHaveBeenCalled();
    expect(await refundRow(o.id)).toMatchObject({ status: 'processed', gateway_refund_id: sent.gatewayRefundId });
  });
});

describe('auto-cancel counts from payment (H1-H2)', () => {
  test('H1-H2: placed long ago but paid just now is kept; 20 minutes after payment it is cancelled and refunded', async () => {
    const o = await placePaidOrder(customer.token, cart);
    await pool.query("UPDATE orders SET created_at = now() - interval '2 hours' WHERE id = $1", [o.id]);
    expect((await cancelUnconfirmedOrders()).cancelled).not.toContain(o.id);
    expect((await getOrder(o.id)).status).toBe('pending');

    await pool.query("UPDATE payments SET paid_at = now() - interval '20 minutes' WHERE order_id = $1", [o.id]);
    const result = await cancelUnconfirmedOrders();
    expect(result.cancelled).toContain(o.id);
    await paymentService.processRefunds();
    const after = await getOrder(o.id);
    expect(after.status).toBe('cancelled');
    expect(after.history.at(-1).actor).toBe('system');
    expect(after.payment.refund).toMatchObject({ status: 'processed', amountPaise: 33000, reason: 'Not confirmed by the restaurant within 15 minutes' });
  });
});

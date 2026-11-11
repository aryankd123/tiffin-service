// Subscriptions paid upfront, pro-rata refunds, the database's refund and status rules, and the
// payment webhook (M1-M13, N1-N7, G1-G16). Webhooks are sent as raw signed bytes, the way
// Razorpay sends them.
const request = require('supertest');
const { pool } = require('../../src/db');
const clock = require('../../src/clock');
const { gateway } = require('../../src/payments/gateway');
const { hmacHex } = require('../../src/payments/signatures');
const paymentService = require('../../src/services/paymentService');
const { proRataRefundPaise } = require('../../src/services/subscriptionService');
const { scheduleDeliveries } = require('../../src/jobs/subscriptionDeliveries');
const { app, call, login, registerUser, errorCode, placeOrder, pay, subscribePaid } = require('../helpers/api');
const { resetWorld } = require('../helpers/world');

const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const now = clock.istNow();
const today = now.date;
const firstOpen = clock.firstOpenDate(now);

let world; let customer; let vendor; let admin; let stranger; let k; let planNo = 0;

beforeAll(async () => {
  world = await resetWorld();
  customer = await login(world.users.customer.email);
  vendor = await login(world.users.vendor.email);
  admin = await login(world.users.admin.email);
  stranger = await registerUser('subpay.stranger');
  k = world.restaurants.koramangala;
});

const newPlan = async (mealsCount, pricePaise) => (await call('POST', `/restaurants/${k.id}/plans`, {
  token: vendor.token, body: { name: `Plan ${++planNo}`, mealSlot: 'lunch', mealsCount, pricePaise },
})).body.plan.id;
const subscribe = (planId, extra = {}) => call('POST', '/subscriptions', {
  token: customer.token, body: { planId, addressId: world.addresses.home, weekdays: ALL_DAYS, ...extra },
});
const getSub = async (id, token = customer.token) => (await call('GET', `/subscriptions/${id}`, { token })).body.subscription;
const getOrder = async (id) => (await call('GET', `/orders/${id}`, { token: customer.token })).body.order;
const hasDelivery = async (subId, date) => (await pool.query(
  'SELECT 1 FROM subscription_deliveries WHERE subscription_id = $1 AND delivery_date = $2', [subId, date])).rowCount === 1;

// A paid subscription that (SQL) started 40 days ago, with deliveries on its first days made by
// the real job and marked by the kitchen. 40 days back, no other subscription is running yet.
async function withPastDeliveries(subId, statuses) {
  const start = clock.addDays(today, -40);
  await pool.query('UPDATE subscriptions SET start_date = $2 WHERE id = $1', [subId, start]);
  for (let i = 0; i < statuses.length; i++) {
    const date = clock.addDays(start, i);
    await scheduleDeliveries(date);
    if (statuses[i] !== 'scheduled') {
      const { rows } = await pool.query('SELECT id FROM subscription_deliveries WHERE subscription_id = $1 AND delivery_date = $2', [subId, date]);
      await call('PATCH', `/deliveries/${rows[0].id}/status`, { token: vendor.token, body: { status: statuses[i] } });
    }
  }
}

describe('subscribing and paying (M1-M13)', () => {
  let s1; let p1; let planA;

  test('M1: a new subscription waits for its payment', async () => {
    planA = await newPlan(5, 60000);
    const res = await subscribe(planA, { weekdays: ['mon', 'wed', 'fri'] });
    expect(res.status).toBe(201);
    ({ subscription: s1, payment: p1 } = res.body);
    expect(s1).toMatchObject({ status: 'awaiting_payment', nextDeliveryDates: [] });
    expect(p1).toMatchObject({ status: 'created', amountPaise: 60000 });
  });

  test('M2-M6: unpaid: hidden from the kitchen, no skips, no duplicate, same checkout, no strangers', async () => {
    expect((await call('GET', `/subscriptions/${s1.id}`, { token: vendor.token })).status).toBe(404);
    expect((await call('POST', `/subscriptions/${s1.id}/cancel`, { token: vendor.token })).status).toBe(404);
    const skip = await call('POST', `/subscriptions/${s1.id}/skips`, { token: customer.token, body: { date: clock.addDays(firstOpen, 2) } });
    expect([skip.status, errorCode(skip)]).toEqual([409, 'SUBSCRIPTION_NOT_ACTIVE']);
    const dup = await subscribe(planA, { weekdays: ['tue'] });
    expect([dup.status, errorCode(dup)]).toEqual([409, 'SUBSCRIPTION_EXISTS']);
    expect(dup.body.error.details).toEqual({ subscriptionId: s1.id, status: 'awaiting_payment' });
    const again = await call('POST', `/subscriptions/${s1.id}/payment`, { token: customer.token });
    expect(again.body.payment.gatewayOrderId).toBe(p1.gatewayOrderId);
    expect((await call('POST', `/subscriptions/${s1.id}/payment`, { token: stranger.token })).status).toBe(404);
  });

  test('M7: a forged signature is refused; the real one activates it, and the kitchen can see it', async () => {
    const paid = gateway.simulatePayment(p1.gatewayOrderId);
    const forged = hmacHex('a-guessed-secret', `${p1.gatewayOrderId}|${paid.gatewayPaymentId}`);
    const bad = await call('POST', `/subscriptions/${s1.id}/payment/verify`, { token: customer.token, body: { gatewayPaymentId: paid.gatewayPaymentId, signature: forged } });
    expect([bad.status, errorCode(bad)]).toEqual([400, 'INVALID_PAYMENT_SIGNATURE']);
    const ok = await call('POST', `/subscriptions/${s1.id}/payment/verify`, { token: customer.token, body: paid });
    expect(ok.status).toBe(200);
    expect(ok.body.subscription.status).toBe('active');
    expect(ok.body.subscription.nextDeliveryDates.length).toBeGreaterThan(0);
    expect((await call('GET', `/subscriptions/${s1.id}`, { token: vendor.token })).status).toBe(200);
  });

  test('M8: the nightly job schedules paid subscriptions only', async () => {
    const day = clock.addDays(firstOpen, 7);
    const unpaid = (await subscribe(await newPlan(5, 60000), { startDate: day })).body.subscription;
    const paid = await subscribePaid(customer.token, { planId: await newPlan(5, 60000), addressId: world.addresses.home, weekdays: ALL_DAYS, startDate: day });
    await scheduleDeliveries(day);
    expect(await hasDelivery(paid.id, day)).toBe(true);
    expect(await hasDelivery(unpaid.id, day)).toBe(false);
  });

  test('M9: a start date that locked while the customer was paying moves to the first open date', async () => {
    const res = await subscribe(await newPlan(5, 60000));
    await pool.query('UPDATE subscriptions SET start_date = $2 WHERE id = $1', [res.body.subscription.id, today]);
    const paid = await pay(customer.token, `/subscriptions/${res.body.subscription.id}`, res.body.payment);
    expect(paid.body.subscription.startDate).toBe(firstOpen);
  });

  let expiredSub; let expiredPay; let retry;
  test('M10: unpaid after 15 minutes: expired; a new attempt is then allowed', async () => {
    const planE = await newPlan(5, 60000);
    ({ subscription: expiredSub, payment: expiredPay } = (await subscribe(planE)).body);
    await pool.query("UPDATE payments SET created_at = now() - interval '16 minutes' WHERE subscription_id = $1", [expiredSub.id]);
    await paymentService.reconcileAndExpire();
    const s = await getSub(expiredSub.id);
    expect(s.status).toBe('expired');
    expect(s.payment.status).toBe('expired');
    retry = await subscribe(planE);
    expect(retry.status).toBe(201);
  });

  test('M11: paying the expired one anyway is accepted and refunded in full', async () => {
    const late = gateway.simulatePayment(expiredPay.gatewayOrderId);
    expect((await call('POST', `/subscriptions/${expiredSub.id}/payment/verify`, { token: customer.token, body: late })).status).toBe(200);
    const s = await getSub(expiredSub.id);
    expect(s.status).toBe('expired');
    expect(s.payment.refund).toMatchObject({ status: 'requested', amountPaise: 60000, reason: 'Payment arrived after the subscription was closed' });
  });

  test('M12: paid but never reported: the status-check job activates it', async () => {
    const res = (await subscribe(await newPlan(5, 60000))).body;
    gateway.simulatePayment(res.payment.gatewayOrderId);
    await paymentService.reconcileAndExpire();
    expect((await getSub(res.subscription.id)).status).toBe('active');
  });

  test('M13: cancelling an unpaid subscription refunds nothing', async () => {
    const res = await call('POST', `/subscriptions/${retry.body.subscription.id}/cancel`, { token: customer.token, body: { reason: 'Changed my mind' } });
    expect(res.body.subscription.status).toBe('cancelled');
    expect(res.body.subscription.payment.refund ?? null).toBeNull();
  });
});

describe('pro-rata refunds and database rules (N1-N7)', () => {
  const ids = {};
  const cancel = (token, id, body) => call('POST', `/subscriptions/${id}/cancel`, { token, body });

  test('N1: nothing delivered: everything back', async () => {
    const s = await subscribePaid(customer.token, { planId: await newPlan(5, 60000), addressId: world.addresses.home, weekdays: ALL_DAYS, startDate: clock.addDays(firstOpen, 20) });
    ids.n1 = s.id;
    const res = await cancel(customer.token, s.id);
    expect(res.body.subscription.payment.refund).toMatchObject({ amountPaise: 60000, reason: 'Subscription cancelled by customer: 5 of 5 meals unused' });
  });

  test('N2: 2 delivered, 1 missed, 1 scheduled: the 2 unused meals (the missed one included) come back', async () => {
    const s = await subscribePaid(customer.token, { planId: await newPlan(5, 60000), addressId: world.addresses.home, weekdays: ALL_DAYS });
    ids.n2 = s.id;
    await withPastDeliveries(s.id, ['delivered', 'delivered', 'missed', 'scheduled']);
    expect((await getSub(s.id)).progress).toEqual({ delivered: 2, scheduled: 1, missed: 1, remaining: 3 });
    const res = await cancel(vendor.token, s.id, { reason: 'Kitchen closing' });
    expect(res.body.subscription.payment.refund).toMatchObject({ amountPaise: 24000, reason: 'Subscription cancelled by restaurant: 2 of 5 meals unused' });
  });

  test('N3: an amount that does not divide evenly is rounded down', async () => {
    const s = await subscribePaid(customer.token, { planId: await newPlan(3, 100000), addressId: world.addresses.home, weekdays: ALL_DAYS });
    ids.n3 = s.id;
    await withPastDeliveries(s.id, ['delivered']);
    const res = await cancel(admin.token, s.id);
    expect(res.body.subscription.payment.refund).toMatchObject({ amountPaise: 66666, reason: 'Subscription cancelled by admin: 2 of 3 meals unused' });
    expect(proRataRefundPaise(100000, 2, 3)).toBe(66666);
  });

  test('N4-N5: nothing unused: no refund; cancelling twice is refused', async () => {
    const s = await subscribePaid(customer.token, { planId: await newPlan(2, 40000), addressId: world.addresses.home, weekdays: ALL_DAYS });
    await withPastDeliveries(s.id, ['delivered', 'scheduled']);
    const res = await cancel(customer.token, s.id);
    expect(res.body.subscription.status).toBe('cancelled');
    expect(res.body.subscription.payment.refund).toBeNull();
    const again = await cancel(vendor.token, ids.n2);
    expect([again.status, errorCode(again)]).toEqual([409, 'CANCEL_NOT_ALLOWED']);
  });

  test('N6: the database refuses refunds above the payment or on unpaid payments, and illegal status changes', async () => {
    const paidSub = await subscribePaid(customer.token, { planId: await newPlan(5, 60000), addressId: world.addresses.home, weekdays: ALL_DAYS });
    const unpaidSub = (await subscribe(await newPlan(5, 60000))).body.subscription;
    const paymentOf = async (subId) => (await pool.query('SELECT id, amount_paise FROM payments WHERE subscription_id = $1', [subId])).rows[0];
    const insertRefund = (paymentId, amount) => pool.query(
      "INSERT INTO refunds (payment_id, amount_paise, reason) VALUES ($1, $2, 'test')", [paymentId, amount]);

    await expect(insertRefund((await paymentOf(paidSub.id)).id, 60001)).rejects.toMatchObject({ constraint: 'refunds_amount_within_payment' });
    await expect(insertRefund((await paymentOf(unpaidSub.id)).id, 100)).rejects.toMatchObject({ constraint: 'refunds_payment_is_paid' });
    await expect(pool.query(
      'UPDATE refunds SET amount_paise = 60001 WHERE payment_id = (SELECT id FROM payments WHERE subscription_id = $1)', [ids.n1],
    )).rejects.toMatchObject({ constraint: 'refunds_amount_within_payment' });
    await expect(pool.query("UPDATE subscriptions SET status = 'awaiting_payment' WHERE id = $1", [paidSub.id]))
      .rejects.toMatchObject({ constraint: 'subscriptions_status_transition' });
    await pool.query("UPDATE subscriptions SET status = 'completed', end_date = $2 WHERE id = $1", [paidSub.id, firstOpen]);
    await expect(pool.query("UPDATE subscriptions SET status = 'active' WHERE id = $1", [paidSub.id]))
      .rejects.toMatchObject({ constraint: 'subscriptions_status_transition' });
  });

  test('N7: the refund job sends every requested refund', async () => {
    const result = await paymentService.processRefunds();
    expect(result).toMatchObject({ checked: 4, processed: 4 }); // M11, N1, N2, N3
    const { rows } = await pool.query(
      `SELECT p.subscription_id, r.amount_paise, r.status FROM refunds r JOIN payments p ON p.id = r.payment_id
       WHERE p.subscription_id = ANY($1::bigint[]) ORDER BY r.id`, [[ids.n1, ids.n2, ids.n3]]);
    expect(rows.map((r) => [r.subscription_id, r.amount_paise, r.status])).toEqual([
      [ids.n1, 60000, 'processed'], [ids.n2, 24000, 'processed'], [ids.n3, 66666, 'processed'],
    ]);
  });
});

describe('the payment webhook (G1-G16)', () => {
  let n = 0;
  const eventId = () => `evt_test_${++n}`;
  const paymentEvent = (event, { payId, orderId, amount, status = 'captured' }) => ({
    entity: 'event', account_id: 'acc_test', event, contains: ['payment'],
    payload: { payment: { entity: { id: payId, entity: 'payment', amount, currency: 'INR', status, order_id: orderId, method: 'upi', email: 'void@example.com', contact: '+919876543210' } } },
    created_at: Math.floor(Date.now() / 1000),
  });
  function webhook(body, { id = eventId(), signature, contentType = 'application/json', raw } = {}) {
    const bytes = raw ?? JSON.stringify(body);
    let req = request(app).post('/api/v1/payments/webhook').set('content-type', contentType);
    if (signature !== null) req = req.set('x-razorpay-signature', signature ?? gateway.signWebhook(JSON.stringify(body)));
    if (id) req = req.set('x-razorpay-event-id', id);
    return req.send(bytes);
  }

  test('G1-G3: a subscription paid while the browser was closed; duplicates and repeats change nothing', async () => {
    const { subscription, payment } = (await subscribe(await newPlan(5, 60000))).body;
    const paid = gateway.simulatePayment(payment.gatewayOrderId);
    const event = paymentEvent('payment.captured', { payId: paid.gatewayPaymentId, orderId: payment.gatewayOrderId, amount: 60000 });
    const id = eventId();
    const first = await webhook(event, { id });
    expect([first.status, first.body.outcome]).toEqual([200, 'paid']);
    expect((await getSub(subscription.id)).status).toBe('active');
    expect((await webhook(event, { id })).body).toMatchObject({ outcome: 'duplicate', firstOutcome: 'paid' });
    expect((await webhook({ ...event, event: 'order.paid' })).body.outcome).toBe('already_paid');
  });

  describe('forged, tampered and odd events on an unpaid order', () => {
    let order; let payment; let paid; let event;
    beforeAll(async () => {
      const cart = { restaurantId: k.id, addressId: world.addresses.home, items: [{ menuItemId: k.items['Veg Thali'], quantity: 1 }] };
      ({ order, payment } = (await placeOrder(customer.token, cart)).body);
      paid = gateway.simulatePayment(payment.gatewayOrderId);
      event = paymentEvent('payment.captured', { payId: paid.gatewayPaymentId, orderId: payment.gatewayOrderId, amount: order.totalPaise });
    });

    test('G4-G7: a wrong or missing signature, a changed body, or a non-JSON content type → 400', async () => {
      for (const res of [
        await webhook(event, { signature: hmacHex('a-guessed-secret', JSON.stringify(event)) }),
        await webhook(event, { signature: null }),
        await webhook(event, { raw: JSON.stringify(event).replace(`"amount":${order.totalPaise}`, '"amount":100') }),
        await webhook(event, { contentType: 'text/plain' }),
      ]) {
        expect([res.status, errorCode(res)]).toEqual([400, 'INVALID_WEBHOOK_SIGNATURE']);
      }
    });

    test('G8-G10: correctly signed but not ours, the wrong amount, or a payment the gateway never saw → ignored', async () => {
      const entity = event.payload.payment.entity;
      const withEntity = (over) => ({ ...event, payload: { payment: { entity: { ...entity, ...over } } } });
      expect((await webhook(withEntity({ order_id: 'order_fake_unknown' }))).body.outcome).toBe('unknown_order');
      expect((await webhook(withEntity({ amount: 100 }))).body.outcome).toBe('amount_mismatch');
      expect((await webhook(withEntity({ id: 'pay_fake_invented' }))).body.outcome).toBe('not_captured');
      expect((await getOrder(order.id)).status).toBe('awaiting_payment');
    });

    test('G11: the genuine event pays the order, recorded as done by the system', async () => {
      expect((await webhook(event)).body.outcome).toBe('paid');
      const o = await getOrder(order.id);
      expect(o.status).toBe('pending');
      expect(o.history.at(-1)).toMatchObject({ actor: 'system', note: 'Payment received' });
    });

    test('G16: a second successful payment on an already paid order is recognised, not applied', async () => {
      const second = gateway.simulatePayment(payment.gatewayOrderId);
      const res = await webhook(paymentEvent('payment.captured', { payId: second.gatewayPaymentId, orderId: payment.gatewayOrderId, amount: order.totalPaise }));
      expect(res.body.outcome).toBe('second_payment');
    });
  });

  test('G12: an authorised-only payment is captured by the handler, then applied', async () => {
    const cart = { restaurantId: k.id, addressId: world.addresses.home, items: [{ menuItemId: k.items['Veg Thali'], quantity: 1 }] };
    const { order, payment } = (await placeOrder(customer.token, cart)).body;
    const paid = gateway.simulatePayment(payment.gatewayOrderId, { status: 'authorized' });
    const res = await webhook(paymentEvent('payment.authorized', { payId: paid.gatewayPaymentId, orderId: payment.gatewayOrderId, amount: order.totalPaise, status: 'authorized' }));
    expect(res.body.outcome).toBe('paid');
    expect((await getOrder(order.id)).status).toBe('pending');
    expect((await gateway.fetchPayments(payment.gatewayOrderId))[0].status).toBe('captured');
  });

  test('G13: events that are not about payments are acknowledged and ignored', async () => {
    const res = await webhook({ entity: 'event', event: 'refund.processed', payload: {} });
    expect([res.status, res.body.outcome]).toEqual([200, 'ignored']);
  });

  test('G14: a payment for an expired order arriving by webhook is refunded in full', async () => {
    const cart = { restaurantId: k.id, addressId: world.addresses.home, items: [{ menuItemId: k.items['Veg Thali'], quantity: 1 }] };
    const { order, payment } = (await placeOrder(customer.token, cart)).body;
    await pool.query("UPDATE payments SET created_at = now() - interval '16 minutes' WHERE order_id = $1", [order.id]);
    await paymentService.reconcileAndExpire();
    expect((await getOrder(order.id)).status).toBe('expired');
    const paid = gateway.simulatePayment(payment.gatewayOrderId);
    const res = await webhook(paymentEvent('payment.captured', { payId: paid.gatewayPaymentId, orderId: payment.gatewayOrderId, amount: order.totalPaise }));
    expect(res.body.outcome).toBe('paid_late_refund');
    const o = await getOrder(order.id);
    expect(o.status).toBe('expired');
    expect(o.payment.refund).toMatchObject({ status: 'requested', amountPaise: 18000 });
  });

  test("G15: only ids and outcomes are stored: never the customer's email or phone", async () => {
    const { rows } = await pool.query('SELECT * FROM payment_webhook_events ORDER BY received_at');
    expect(Object.keys(rows[0]).sort()).toEqual(['event', 'event_id', 'gateway_payment_id', 'outcome', 'received_at']);
    expect(rows.map((r) => r.outcome)).toEqual(expect.arrayContaining(['paid', 'already_paid', 'unknown_order', 'amount_mismatch', 'not_captured', 'second_payment', 'ignored', 'paid_late_refund']));
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain('void@example.com');
    expect(stored).not.toContain('9876543210');
  });
});

// Subscription payment and webhook tests: subscriptions paid upfront, pro-rata refunds, database
// backstops, and the payment webhook.
// Needs the server on :3000 started with JOBS_ENABLED=false and PAYMENT_PROVIDER=fake (the
// default), migrations 001-010 and `npm run seed`. Payment jobs run inside the server through
// POST /api/v1/dev/jobs/:job (the fake gateway's memory lives there); the delivery job is called
// directly. Run from the server folder:
//   node scripts/manual-tests/subscription-payments.manual.js
// Where time must have passed (a checkout 16 minutes old, a subscription that started 40 days
// ago), that is simulated with a labelled SQL UPDATE.
require('../../src/config');
const { pool } = require('../../src/db');
const clock = require('../../src/clock');
const { hmacHex } = require('../../src/payments/signatures');
const { createFakeGateway } = require('../../src/payments/fakeGateway');
const { scheduleDeliveries } = require('../../src/jobs/subscriptionDeliveries');
const { proRataRefundPaise } = require('../../src/services/subscriptionService');
const {
  BASE, call, show, note, registerUser, login, placeOrder, paySubscription, subscribePaid,
} = require('./_http');

const SEED_PASSWORD = process.env.SEED_PASSWORD;
const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const ok = (b) => (b ? 'yes' : 'NO');
const runId = Date.now();

async function sqlBlocked(id, label, sql, params) {
  try {
    await pool.query(sql, params);
    console.log(`${id.padEnd(6)} ${label.padEnd(54)} ACCEPTED (unexpected)`);
  } catch (e) {
    console.log(`${id.padEnd(6)} ${label.padEnd(54)} blocked: ${e.constraint ?? e.message}`);
  }
}

// Plays Razorpay calling the webhook URL. The fake's webhook secret is a fixed constant, so a
// fake instance in this process signs exactly as the server's fake verifies.
const signer = createFakeGateway();
let eventNo = 0;
const newEventId = () => `evt_test_${runId}_${++eventNo}`;

async function sendWebhook(body, { eventId, signature, contentType = 'application/json', rawOverride } = {}) {
  const raw = JSON.stringify(body);
  const headers = { 'content-type': contentType };
  if (signature !== null) headers['x-razorpay-signature'] = signature ?? signer.signWebhook(raw);
  if (eventId) headers['x-razorpay-event-id'] = eventId;
  const res = await fetch(`${BASE}/payments/webhook`, { method: 'POST', headers, body: rawOverride ?? raw });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

// The shape of a Razorpay payment event (customer email and phone included, as Razorpay sends them).
const paymentEvent = (event, { payId, orderId, amount, status = 'captured' }) => ({
  entity: 'event',
  account_id: 'acc_test',
  event,
  contains: ['payment'],
  payload: {
    payment: {
      entity: {
        id: payId, entity: 'payment', amount, currency: 'INR', status, order_id: orderId,
        method: 'upi', email: 'void@example.com', contact: '+919876543210',
      },
    },
  },
  created_at: Math.floor(Date.now() / 1000),
});

(async () => {
  const customer = await login('seed.customer@example.com', SEED_PASSWORD);
  const vendor = await login('seed.vendor@example.com', SEED_PASSWORD);
  const admin = await login('seed.admin@example.com', SEED_PASSWORD);
  const stranger = await registerUser('subpay.stranger');
  const home = (await call('GET', '/addresses', { token: customer.token })).json.addresses.find((a) => a.label === 'Home');
  const kora = (await pool.query("SELECT id FROM restaurants WHERE name = 'Seed Koramangala Kitchen'")).rows[0].id;
  const thali = (await pool.query("SELECT id FROM menu_items WHERE restaurant_id = $1 AND name = 'Veg Thali'", [kora])).rows[0].id;
  const cart = { restaurantId: kora, addressId: home.id, items: [{ menuItemId: thali, quantity: 1 }] };
  const now = clock.istNow();
  const today = now.date;
  const firstOpen = clock.firstOpenDate(now);
  const job = (name) => call('POST', `/dev/jobs/${name}`, { token: admin.token });
  const getSub = async (id, token = customer.token) => (await call('GET', `/subscriptions/${id}`, { token })).json.subscription;
  const getOrder = async (id) => (await call('GET', `/orders/${id}`, { token: customer.token })).json.order;
  const fakePay = async (gatewayOrderId, status = 'captured') =>
    (await call('POST', '/dev/fake-gateway/pay', { token: customer.token, body: { gatewayOrderId, status } })).json;

  let planNo = 0;
  const newPlan = async (mealsCount, pricePaise) => (await call('POST', `/restaurants/${kora}/plans`, {
    token: vendor.token, body: { name: `Test 6B ${runId}-${++planNo}`, mealSlot: 'lunch', mealsCount, pricePaise },
  })).json.plan;
  const subscribe = (planId, extra = {}) =>
    call('POST', '/subscriptions', { token: customer.token, body: { planId, addressId: home.id, weekdays: ALL_DAYS, ...extra } });

  // A paid subscription that (SQL) started 40 days ago, with deliveries on its first days created
  // by the real job and marked by the vendor through the API. 40 days back is before every other
  // test subscription started, so the job only touches this one.
  async function withPastDeliveries(subId, statuses) {
    const start = clock.addDays(today, -40);
    await pool.query('UPDATE subscriptions SET start_date = $2 WHERE id = $1', [subId, start]);
    for (let i = 0; i < statuses.length; i++) {
      const date = clock.addDays(start, i);
      await scheduleDeliveries(date);
      const { rows } = await pool.query(
        'SELECT id FROM subscription_deliveries WHERE subscription_id = $1 AND delivery_date = $2', [subId, date]);
      if (statuses[i] !== 'scheduled') {
        await call('PATCH', `/deliveries/${rows[0].id}/status`, { token: vendor.token, body: { status: statuses[i] } });
      }
    }
  }

  note(`IST now ${today}, first open date ${firstOpen}`);

  console.log('\n=== M1-M7 subscribing and paying');
  const planA = await newPlan(5, 60000);
  const m1 = await call('POST', '/subscriptions', { token: customer.token, body: { planId: planA.id, addressId: home.id, weekdays: ['mon', 'wed', 'fri'] } });
  const s1 = m1.json.subscription;
  const p1 = m1.json.payment;
  show('M1', 'subscribe: 5 lunches, ₹600', m1, `\n       → status ${s1.status}, payment ${p1?.status} ${p1?.amountPaise} paise (= plan price: ${ok(p1?.amountPaise === planA.pricePaise)}), next dates ${JSON.stringify(s1.nextDeliveryDates)}`);
  show('M2a', 'the vendor GETs the unpaid subscription', await call('GET', `/subscriptions/${s1.id}`, { token: vendor.token }));
  show('M2b', 'the vendor cancels it', await call('POST', `/subscriptions/${s1.id}/cancel`, { token: vendor.token }));
  show('M3', 'the customer skips a day on it', await call('POST', `/subscriptions/${s1.id}/skips`, { token: customer.token, body: { date: clock.addDays(firstOpen, 2) } }));
  const m4 = await call('POST', '/subscriptions', { token: customer.token, body: { planId: planA.id, addressId: home.id, weekdays: ['tue'] } });
  show('M4', 'subscribe again: same plan + address', m4, `→ points to ${s1.id}: ${ok(m4.json.error?.details?.subscriptionId === s1.id)}`);
  const m5 = await call('POST', `/subscriptions/${s1.id}/payment`, { token: customer.token });
  show('M5', 'POST /subscriptions/:id/payment again', m5, `→ same gateway order: ${ok(m5.json.payment?.gatewayOrderId === p1.gatewayOrderId)}`);
  show('M6', "a stranger starts this subscription's checkout", await call('POST', `/subscriptions/${s1.id}/payment`, { token: stranger.token }));
  const paidA = await fakePay(p1.gatewayOrderId);
  const forged = hmacHex('a-guessed-secret', `${p1.gatewayOrderId}|${paidA.gatewayPaymentId}`);
  show('M7a', 'verify with a forged signature', await call('POST', `/subscriptions/${s1.id}/payment/verify`, { token: customer.token, body: { gatewayPaymentId: paidA.gatewayPaymentId, signature: forged } }));
  const m7 = await call('POST', `/subscriptions/${s1.id}/payment/verify`, { token: customer.token, body: paidA });
  show('M7b', 'verify with the real signature', m7, `\n       → payment ${m7.json.payment?.status}, subscription ${m7.json.subscription?.status}, next dates ${JSON.stringify(m7.json.subscription?.nextDeliveryDates.slice(0, 3))}`);
  show('M7c', 'the vendor GETs it now', await call('GET', `/subscriptions/${s1.id}`, { token: vendor.token }), '(paid: visible)');

  console.log('\n=== M8-M9 the job and the start date');
  const s8day = clock.addDays(firstOpen, 7);
  const unpaid8 = (await subscribe((await newPlan(5, 60000)).id, { startDate: s8day })).json.subscription;
  const paid8 = (await subscribePaid(customer.token, { planId: (await newPlan(5, 60000)).id, addressId: home.id, weekdays: ALL_DAYS, startDate: s8day })).json.subscription;
  const j8 = await scheduleDeliveries(s8day);
  const has = async (subId, date) => (await pool.query(
    'SELECT 1 FROM subscription_deliveries WHERE subscription_id = $1 AND delivery_date = $2', [subId, date])).rowCount === 1;
  console.log(`M8     nightly job for ${s8day}                         → ${JSON.stringify(j8)}; paid ${paid8.id} got one: ${ok(await has(paid8.id, s8day))}, unpaid ${unpaid8.id} got one: ${ok(await has(unpaid8.id, s8day))} (expected NO)`);
  const m9 = await subscribe((await newPlan(5, 60000)).id);
  await pool.query('UPDATE subscriptions SET start_date = $2 WHERE id = $1', [m9.json.subscription.id, today]);
  note(`subscription ${m9.json.subscription.id}: SQL start_date → ${today} (the cutoff passed while the customer was paying)`);
  const m9paid = await paySubscription(customer.token, m9.json.subscription.id, m9.json.payment);
  show('M9', 'pay for it', m9paid, `→ startDate ${m9paid.json.subscription?.startDate} (= first open ${firstOpen}: ${ok(m9paid.json.subscription?.startDate === firstOpen)})`);

  console.log('\n=== M10-M13 expiry, late payment, the status check, cancelling unpaid');
  const planE = await newPlan(5, 60000);
  const m10 = await subscribe(planE.id);
  const s10 = m10.json.subscription;
  await pool.query("UPDATE payments SET created_at = now() - interval '16 minutes' WHERE subscription_id = $1", [s10.id]);
  note(`subscription ${s10.id}: SQL checkout moved 16 minutes back`);
  const m10job = await job('payments');
  const s10after = await getSub(s10.id);
  show('M10a', 'payments job', m10job, `→ subscription ${s10after.status}, payment ${s10after.payment?.status}`);
  const m10b = await subscribe(planE.id);
  show('M10b', 'subscribe again to the same plan + address', m10b, `→ ${m10b.json.subscription?.status} (an expired one doesn't block)`);
  const late = await fakePay(m10.json.payment.gatewayOrderId);
  const m11 = await call('POST', `/subscriptions/${s10.id}/payment/verify`, { token: customer.token, body: late });
  const s11 = await getSub(s10.id);
  show('M11', 'the customer pays the expired one anyway', m11, `\n       → subscription ${s11.status}, payment ${s11.payment?.status}, refund ${JSON.stringify(s11.payment?.refund)}`);
  const m12 = await subscribe((await newPlan(5, 60000)).id);
  await fakePay(m12.json.payment.gatewayOrderId); // paid, but the browser never reports it
  const m12job = await job('payments');
  show('M12', 'paid but never verified; payments job', m12job, `→ subscription ${(await getSub(m12.json.subscription.id)).status}`);
  const m13 = await call('POST', `/subscriptions/${m10b.json.subscription.id}/cancel`, { token: customer.token, body: { reason: 'Changed my mind' } });
  show('M13', 'the customer cancels an unpaid subscription', m13, `→ ${m13.json.subscription?.status}, refund ${JSON.stringify(m13.json.subscription?.payment?.refund ?? null)}`);

  console.log('\n=== N1-N5 pro-rata refunds');
  const n1sub = (await subscribePaid(customer.token, { planId: (await newPlan(5, 60000)).id, addressId: home.id, weekdays: ALL_DAYS, startDate: clock.addDays(firstOpen, 20) })).json.subscription;
  const n1 = await call('POST', `/subscriptions/${n1sub.id}/cancel`, { token: customer.token });
  show('N1', 'cancel a paid 5-meal ₹600 plan, nothing delivered', n1, `\n       → refund ${JSON.stringify(n1.json.subscription?.payment?.refund)}`);
  const n2sub = (await subscribePaid(customer.token, { planId: (await newPlan(5, 60000)).id, addressId: home.id, weekdays: ALL_DAYS })).json.subscription;
  await withPastDeliveries(n2sub.id, ['delivered', 'delivered', 'missed', 'scheduled']);
  note(`subscription ${n2sub.id}: SQL start 40 days ago; job + vendor: delivered, delivered, missed, scheduled → progress ${JSON.stringify((await getSub(n2sub.id)).progress)}`);
  const n2 = await call('POST', `/subscriptions/${n2sub.id}/cancel`, { token: vendor.token, body: { reason: 'Kitchen closing' } });
  show('N2', 'the vendor cancels it', n2, `\n       → refund ${JSON.stringify(n2.json.subscription?.payment?.refund)} (expected 60000 × 2 ÷ 5 = 24000)`);
  const n3sub = (await subscribePaid(customer.token, { planId: (await newPlan(3, 100000)).id, addressId: home.id, weekdays: ALL_DAYS })).json.subscription;
  await withPastDeliveries(n3sub.id, ['delivered']);
  const n3 = await call('POST', `/subscriptions/${n3sub.id}/cancel`, { token: admin.token });
  show('N3', '3 meals for ₹1000, 1 delivered; the admin cancels', n3, `\n       → refund ${JSON.stringify(n3.json.subscription?.payment?.refund)} (100000 × 2 ÷ 3 = 66666.67 → 66666; function: ${proRataRefundPaise(100000, 2, 3)})`);
  const n4sub = (await subscribePaid(customer.token, { planId: (await newPlan(2, 40000)).id, addressId: home.id, weekdays: ALL_DAYS })).json.subscription;
  await withPastDeliveries(n4sub.id, ['delivered', 'scheduled']);
  const n4 = await call('POST', `/subscriptions/${n4sub.id}/cancel`, { token: customer.token });
  show('N4', '2 meals: 1 delivered, 1 scheduled; cancel', n4, `→ ${n4.json.subscription?.status}, refund ${JSON.stringify(n4.json.subscription?.payment?.refund ?? null)}`);
  show('N5', 'cancel N2 again', await call('POST', `/subscriptions/${n2sub.id}/cancel`, { token: vendor.token }));

  console.log('\n=== N6 database backstops (direct SQL)');
  const paidPayment = (await pool.query('SELECT id, amount_paise FROM payments WHERE subscription_id = $1', [m9.json.subscription.id])).rows[0];
  await sqlBlocked('N6a', `refund of ${paidPayment.amount_paise + 1} on a ${paidPayment.amount_paise}-paise payment`,
    "INSERT INTO refunds (payment_id, amount_paise, reason) VALUES ($1, $2, 'test')", [paidPayment.id, paidPayment.amount_paise + 1]);
  const unpaidPayment = (await pool.query('SELECT id FROM payments WHERE subscription_id = $1', [unpaid8.id])).rows[0];
  await sqlBlocked('N6b', 'refund on an unpaid payment',
    "INSERT INTO refunds (payment_id, amount_paise, reason) VALUES ($1, 100, 'test')", [unpaidPayment.id]);
  await sqlBlocked('N6c', "raise N1's refund above its payment",
    'UPDATE refunds SET amount_paise = 60001 WHERE payment_id = (SELECT id FROM payments WHERE subscription_id = $1)', [n1sub.id]);
  await sqlBlocked('N6d', 'subscription active → awaiting_payment',
    "UPDATE subscriptions SET status = 'awaiting_payment' WHERE id = $1", [s1.id]);
  const completed = (await pool.query("SELECT id FROM subscriptions WHERE status = 'completed' LIMIT 1")).rows[0];
  await sqlBlocked('N6e', `subscription completed → active (${completed.id})`,
    "UPDATE subscriptions SET status = 'active' WHERE id = $1", [completed.id]);

  console.log('\n=== G1-G3 webhook: a subscription paid while the browser was closed');
  const g1 = await subscribe((await newPlan(5, 60000)).id);
  const g1pay = await fakePay(g1.json.payment.gatewayOrderId);
  const g1event = paymentEvent('payment.captured', { payId: g1pay.gatewayPaymentId, orderId: g1.json.payment.gatewayOrderId, amount: 60000 });
  const e1 = newEventId();
  show('G1', 'payment.captured, signed', await sendWebhook(g1event, { eventId: e1 }), `→ subscription ${(await getSub(g1.json.subscription.id)).status}`);
  show('G2', 'the same event id again', await sendWebhook(g1event, { eventId: e1 }));
  show('G3', 'order.paid for the same payment, new event id', await sendWebhook({ ...g1event, event: 'order.paid' }, { eventId: newEventId() }));

  console.log('\n=== G4-G10 webhook: forged, tampered and odd events (order O)');
  const o = await placeOrder(customer.token, cart);
  const oPay = await fakePay(o.json.payment.gatewayOrderId);
  const oEvent = paymentEvent('payment.captured', { payId: oPay.gatewayPaymentId, orderId: o.json.payment.gatewayOrderId, amount: o.json.order.totalPaise });
  note(`order ${o.json.order.id}: paid at the fake gateway, not verified`);
  show('G4', 'signed with a guessed secret', await sendWebhook(oEvent, { eventId: newEventId(), signature: hmacHex('a-guessed-secret', JSON.stringify(oEvent)) }));
  show('G5', 'no signature header', await sendWebhook(oEvent, { eventId: newEventId(), signature: null }));
  const tampered = JSON.stringify(oEvent).replace(`"amount":${o.json.order.totalPaise}`, '"amount":100');
  show('G6', 'signed, then the amount changed to 100', await sendWebhook(oEvent, { eventId: newEventId(), rawOverride: tampered }));
  show('G7', 'valid signature, content-type text/plain', await sendWebhook(oEvent, { eventId: newEventId(), contentType: 'text/plain' }));
  show('G8', 'signed event for an unknown gateway order', await sendWebhook({ ...oEvent, payload: { payment: { entity: { ...oEvent.payload.payment.entity, order_id: 'order_fake_unknown' } } } }, { eventId: newEventId() }));
  show('G9', 'signed event, amount 100 (not the order total)', await sendWebhook(paymentEvent('payment.captured', { payId: oPay.gatewayPaymentId, orderId: o.json.payment.gatewayOrderId, amount: 100 }), { eventId: newEventId() }));
  show('G10', 'signed event, payment id the gateway never saw', await sendWebhook(paymentEvent('payment.captured', { payId: 'pay_fake_invented', orderId: o.json.payment.gatewayOrderId, amount: o.json.order.totalPaise }), { eventId: newEventId() }));
  note(`order ${o.json.order.id} after G4-G10: ${(await getOrder(o.json.order.id)).status} (expected awaiting_payment)`);
  const g11 = await sendWebhook(oEvent, { eventId: newEventId() });
  const oAfter = await getOrder(o.json.order.id);
  show('G11', 'the genuine event', g11, `→ order ${oAfter.status}, last history by ${oAfter.history.at(-1).actor}: "${oAfter.history.at(-1).note}"`);

  console.log('\n=== G12-G15 webhook: authorized, ignored, late, what is stored');
  const o2 = await placeOrder(customer.token, cart);
  const o2Pay = await fakePay(o2.json.payment.gatewayOrderId, 'authorized');
  show('G12', 'payment.authorized (not yet captured)', await sendWebhook(paymentEvent('payment.authorized', { payId: o2Pay.gatewayPaymentId, orderId: o2.json.payment.gatewayOrderId, amount: o2.json.order.totalPaise, status: 'authorized' }), { eventId: newEventId() }), `→ order ${(await getOrder(o2.json.order.id)).status}`);
  show('G13', 'refund.processed (not a payment event)', await sendWebhook({ entity: 'event', event: 'refund.processed', payload: {} }, { eventId: newEventId() }));
  const o3 = await placeOrder(customer.token, cart);
  await pool.query("UPDATE payments SET created_at = now() - interval '16 minutes' WHERE order_id = $1", [o3.json.order.id]);
  await job('payments');
  note(`order ${o3.json.order.id}: SQL checkout 16 minutes old, payments job → ${(await getOrder(o3.json.order.id)).status}`);
  const o3Pay = await fakePay(o3.json.payment.gatewayOrderId);
  const g14 = await sendWebhook(paymentEvent('payment.captured', { payId: o3Pay.gatewayPaymentId, orderId: o3.json.payment.gatewayOrderId, amount: o3.json.order.totalPaise }), { eventId: newEventId() });
  const o3After = await getOrder(o3.json.order.id);
  show('G14', 'a payment for the expired order arrives by webhook', g14, `→ order ${o3After.status}, refund ${JSON.stringify(o3After.payment?.refund)}`);
  const stored = (await pool.query('SELECT * FROM payment_webhook_events WHERE event_id LIKE $1 ORDER BY received_at', [`evt_test_${runId}_%`])).rows;
  console.log(`G15    events recorded this run: ${stored.length}; columns ${Object.keys(stored[0]).join(', ')}`);
  note(`outcomes ${JSON.stringify(stored.map((r) => r.outcome))}`);
  note(`email or phone stored anywhere in them: ${ok(JSON.stringify(stored).includes('void@example.com') || JSON.stringify(stored).includes('9876543210'))} (expected NO)`);

  console.log('\n=== N7 the refunds job');
  const r1 = await job('refunds');
  show('N7', 'refunds job (inside the server)', r1);
  const refunds = (await pool.query(
    `SELECT COALESCE('sub ' || p.subscription_id, 'order ' || p.order_id) AS target, r.amount_paise, r.status, r.reason
     FROM refunds r JOIN payments p ON p.id = r.payment_id
     WHERE p.subscription_id = ANY($1::bigint[]) OR p.order_id = $2 ORDER BY r.id`,
    [[s10.id, n1sub.id, n2sub.id, n3sub.id], o3.json.order.id])).rows;
  for (const r of refunds) note(`${r.target}: ${r.amount_paise} ${r.status} "${r.reason}"`);

  console.log(`\nTest data: plans "Test 6B ${runId}-1…${planNo}", subscriptions ${s1.id} (active), ${n1sub.id}–${n4sub.id} (cancelled), orders ${o.json.order.id}, ${o2.json.order.id}, ${o3.json.order.id}; user ${stranger.email}`);
  await pool.end();
})().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });

// Order payment tests: paying for orders with the fake gateway, verification,
// the status check, expiry, auto-cancel from payment, refunds.
// Needs the server on :3000 started with JOBS_ENABLED=false and PAYMENT_PROVIDER=fake (the
// default); jobs are run inside the server through POST /api/v1/dev/jobs/:job, because the fake
// gateway's memory lives there. Run from the server folder:
//   node scripts/manual-tests/payments.manual.js
// Where time must have passed (an order unpaid for 15 minutes), that is simulated with SQL.
require('../../src/config');
const { pool } = require('../../src/db');
const { hmacHex } = require('../../src/payments/signatures');
const { call, show, note, registerUser, login, placeOrder, payOrder } = require('./_http');

const SEED_PASSWORD = process.env.SEED_PASSWORD;

async function sqlBlocked(id, label, sql, params) {
  try {
    await pool.query(sql, params);
    console.log(`${id.padEnd(6)} ${label.padEnd(54)} ACCEPTED (unexpected)`);
  } catch (e) {
    console.log(`${id.padEnd(6)} ${label.padEnd(54)} blocked: ${e.constraint ?? e.message}`);
  }
}

(async () => {
  const customer = await login('seed.customer@example.com', SEED_PASSWORD);
  const vendor = await login('seed.vendor@example.com', SEED_PASSWORD);
  const admin = await login('seed.admin@example.com', SEED_PASSWORD);
  const stranger = await registerUser('pay.stranger');
  const home = (await call('GET', '/addresses', { token: customer.token })).json.addresses.find((a) => a.label === 'Home');
  const kora = (await pool.query("SELECT id FROM restaurants WHERE name = 'Seed Koramangala Kitchen'")).rows[0].id;
  const thali = (await pool.query("SELECT id FROM menu_items WHERE restaurant_id = $1 AND name = 'Veg Thali'", [kora])).rows[0].id;
  const cart = { restaurantId: kora, addressId: home.id, items: [{ menuItemId: thali, quantity: 2 }] };
  const job = (name) => call('POST', `/dev/jobs/${name}`, { token: admin.token });
  const statusOf = async (id) => (await call('GET', `/orders/${id}`, { token: customer.token })).json.order;

  console.log('\n=== Y1-Y4 checkout');
  const y1 = await placeOrder(customer.token, cart);
  const o1 = y1.json.order;
  const p1 = y1.json.payment;
  show('Y1', 'place an order: 2 × Veg Thali + fee', y1, `\n       → order ${o1.id} status ${o1.status}, payment ${JSON.stringify({ provider: p1?.provider, status: p1?.status, amountPaise: p1?.amountPaise, keyId: p1?.keyId, gatewayOrderId: p1?.gatewayOrderId?.slice(0, 16) + '…' })}`);
  note(`order total ${o1.totalPaise} = payment amount ${p1.amountPaise}: ${o1.totalPaise === p1.amountPaise ? 'yes' : 'NO'}`);
  const y2 = await call('POST', `/orders/${o1.id}/payment`, { token: customer.token });
  show('Y2', 'POST /orders/:id/payment again (same checkout?)', y2, `→ same gateway order: ${y2.json.payment?.gatewayOrderId === p1.gatewayOrderId ? 'yes' : 'NO'}`);
  show('Y3a', "vendor GETs the unpaid order", await call('GET', `/orders/${o1.id}`, { token: vendor.token }));
  const inbox = await call('GET', `/restaurants/${kora}/orders?limit=50`, { token: vendor.token });
  note(`unpaid order in the vendor's inbox: ${inbox.json.orders.some((o) => o.id === o1.id) ? 'YES (wrong)' : 'no'}`);
  show('Y3b', 'vendor confirms the unpaid order', await call('PATCH', `/orders/${o1.id}/status`, { token: vendor.token, body: { status: 'confirmed' } }));
  show('Y4', "a stranger starts this order's checkout", await call('POST', `/orders/${o1.id}/payment`, { token: stranger.token }));

  console.log('\n=== Y5-Y9 verification');
  const paid = await call('POST', '/dev/fake-gateway/pay', { token: customer.token, body: { gatewayOrderId: p1.gatewayOrderId } });
  note(`fake checkout returned payment ${paid.json.gatewayPaymentId.slice(0, 12)}… and a ${paid.json.signature.length}-char signature`);
  const forged = hmacHex('a-guessed-secret', `${p1.gatewayOrderId}|${paid.json.gatewayPaymentId}`);
  show('Y5', 'verify with a signature made with a guessed secret', await call('POST', `/orders/${o1.id}/payment/verify`, { token: customer.token, body: { gatewayPaymentId: paid.json.gatewayPaymentId, signature: forged } }));
  show('Y6', "verify with another order's payment id", await call('POST', `/orders/${o1.id}/payment/verify`, { token: customer.token, body: { gatewayPaymentId: 'pay_fake_someoneelse', signature: paid.json.signature } }));
  const y7 = await call('POST', `/orders/${o1.id}/payment/verify`, { token: customer.token, body: paid.json });
  show('Y7', 'verify with the real signature', y7, `→ payment ${y7.json.payment?.status}, order ${y7.json.order?.status}, last history ${JSON.stringify(y7.json.order?.history.at(-1)?.note)}`);
  const y8 = await call('POST', `/orders/${o1.id}/payment/verify`, { token: customer.token, body: paid.json });
  show('Y8', 'verify again (a retry)', y8, `→ still ${y8.json.order?.status}`);
  const inbox2 = await call('GET', `/restaurants/${kora}/orders?limit=50`, { token: vendor.token });
  note(`paid order now in the vendor's inbox: ${inbox2.json.orders.some((o) => o.id === o1.id) ? 'yes' : 'NO'}`);
  const second = await call('POST', '/dev/fake-gateway/pay', { token: customer.token, body: { gatewayOrderId: p1.gatewayOrderId } });
  show('Y9', 'verify a SECOND payment on the paid order', await call('POST', `/orders/${o1.id}/payment/verify`, { token: customer.token, body: second.json }));

  console.log('\n=== Z1-Z3 the status check (browser closed before verifying)');
  const z = (await placeOrder(customer.token, cart)).json;
  await call('POST', '/dev/fake-gateway/pay', { token: customer.token, body: { gatewayOrderId: z.payment.gatewayOrderId } });
  note(`order ${z.order.id}: paid at the gateway, never verified → ${(await statusOf(z.order.id)).status}`);
  const z1 = await job('payments');
  show('Z1', 'payments job', z1, `→ order ${z.order.id} now ${(await statusOf(z.order.id)).status}, last history actor ${(await statusOf(z.order.id)).history.at(-1).actor}`);
  const za = (await placeOrder(customer.token, cart)).json;
  await call('POST', '/dev/fake-gateway/pay', { token: customer.token, body: { gatewayOrderId: za.payment.gatewayOrderId, status: 'authorized' } });
  await job('payments');
  show('Z2', 'paid but only AUTHORIZED: the job captures it', { status: 200, json: '' }, `→ order ${za.order.id} ${(await statusOf(za.order.id)).status}`);
  const zu = (await placeOrder(customer.token, cart)).json;
  await job('payments');
  show('Z3', 'unpaid and only 0 minutes old: the job leaves it', { status: 200, json: '' }, `→ order ${zu.order.id} ${(await statusOf(zu.order.id)).status}`);

  console.log('\n=== E1-E3 expiry after 15 minutes unpaid');
  await pool.query("UPDATE payments SET created_at = now() - interval '16 minutes' WHERE order_id = $1", [zu.order.id]);
  note(`SQL: order ${zu.order.id}'s checkout moved 16 minutes back`);
  const e1 = await job('payments');
  const expired = await statusOf(zu.order.id);
  show('E1', 'payments job', e1, `→ order ${expired.status}, payment ${expired.payment.status}, history "${expired.history.at(-1).note}" by ${expired.history.at(-1).actor}`);
  const late = await call('POST', '/dev/fake-gateway/pay', { token: customer.token, body: { gatewayOrderId: zu.payment.gatewayOrderId } });
  const e2 = await call('POST', `/orders/${zu.order.id}/payment/verify`, { token: customer.token, body: late.json });
  const afterLate = await statusOf(zu.order.id);
  show('E2', 'the customer pays AFTER expiry, then verifies', e2, `→ order still ${afterLate.status}, payment ${afterLate.payment.status}, refund ${JSON.stringify(afterLate.payment.refund)}`);
  show('E3', 'cancel the expired order', await call('POST', `/orders/${zu.order.id}/cancel`, { token: customer.token }));

  console.log('\n=== F1-F6 cancellations and refunds');
  const r1 = (await placeOrder(customer.token, cart)).json;
  const r1c = await call('POST', `/orders/${r1.order.id}/cancel`, { token: customer.token });
  show('F1', 'customer cancels an UNPAID order', r1c, `→ ${r1c.json.order?.status}, refund ${JSON.stringify(r1c.json.order?.payment?.refund)}`);
  const r2 = (await placeOrder(customer.token, cart)).json;
  await payOrder(customer.token, r2.order.id, r2.payment);
  const r2c = await call('POST', `/orders/${r2.order.id}/cancel`, { token: customer.token, body: { reason: 'Changed my mind' } });
  show('F2', 'customer cancels a PAID pending order', r2c, `→ refund ${JSON.stringify(r2c.json.order?.payment?.refund)}`);
  const r3 = (await placeOrder(customer.token, cart)).json;
  await payOrder(customer.token, r3.order.id, r3.payment);
  await call('PATCH', `/orders/${r3.order.id}/status`, { token: vendor.token, body: { status: 'confirmed' } });
  const r3c = await call('POST', `/orders/${r3.order.id}/cancel`, { token: vendor.token, body: { reason: 'Kitchen closed' } });
  show('F3', 'restaurant cancels a PAID confirmed order', r3c, `→ refund ${JSON.stringify(r3c.json.order?.payment?.refund)}`);
  const rf = await job('refunds');
  show('F4', 'refunds job', rf, `→ F2 refund ${JSON.stringify((await statusOf(r2.order.id)).payment.refund)}`);
  const gwRefund = (await pool.query('SELECT gateway_refund_id, attempts FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE p.order_id = $1', [r2.order.id])).rows[0];
  note(`F2 refund row: gateway id ${gwRefund.gateway_refund_id?.slice(0, 14)}…, attempts ${gwRefund.attempts}`);
  const rf2 = await job('refunds');
  show('F5', 'refunds job again (nothing left)', rf2);
  await sqlBlocked('F6a', 'a second refund for the same payment (SQL)',
    "INSERT INTO refunds (payment_id, amount_paise, reason) SELECT id, 100, 'again' FROM payments WHERE order_id = $1", [r2.order.id]);
  await sqlBlocked('F6b', "payment 'paid' without a gateway payment id (SQL)",
    "UPDATE payments SET status = 'paid', paid_at = now(), gateway_payment_id = NULL WHERE order_id = $1", [r1.order.id]);
  await sqlBlocked('F6c', 'order: awaiting_payment → delivered (SQL)',
    "UPDATE orders SET status = 'delivered' WHERE id = $1", [(await placeOrder(customer.token, cart)).json.order.id]);

  console.log('\n=== H1-H2 auto-cancel counts from payment, and refunds');
  const a1 = (await placeOrder(customer.token, cart)).json;
  await payOrder(customer.token, a1.order.id, a1.payment);
  await pool.query("UPDATE orders SET created_at = now() - interval '2 hours' WHERE id = $1", [a1.order.id]);
  note(`SQL: order ${a1.order.id} placed 2 hours ago, paid just now`);
  const ac = await job('auto-cancel');
  show('H1', 'auto-cancel (paid < 15 min ago)', ac, `→ order ${(await statusOf(a1.order.id)).status}`);
  await pool.query("UPDATE payments SET paid_at = now() - interval '20 minutes' WHERE order_id = $1", [a1.order.id]);
  const ac2 = await job('auto-cancel');
  await job('refunds');
  const a2 = await statusOf(a1.order.id);
  show('H2', 'SQL: paid 20 min ago → auto-cancel, then refunds job', ac2, `→ ${a2.status} by ${a2.history.at(-1).actor}, refund ${JSON.stringify(a2.payment.refund)}`);

  console.log(`\nTest data: orders ${o1.id}, ${z.order.id}, ${za.order.id}, ${zu.order.id}, ${r1.order.id}, ${r2.order.id}, ${r3.order.id}, ${a1.order.id} (+ one in F6c); user ${stranger.email}`);
  await pool.end();
})().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });

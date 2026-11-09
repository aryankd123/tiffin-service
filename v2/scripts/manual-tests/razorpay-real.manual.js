// Razorpay test mode: one real payment through Razorpay in TEST mode (no real money), run
// by hand, step by step, because a person has to pay in Razorpay's checkout window.
// Needs RAZORPAY_KEY_ID (rzp_test_…) and RAZORPAY_KEY_SECRET in .env, typed in by hand,
// and PAYMENT_PROVIDER=razorpay in the server window and this one:
//   window 1 (server):  $env:PAYMENT_PROVIDER = "razorpay"; $env:JOBS_ENABLED = "false"; node src/server.js
//   window 2 (page):    python -m http.server 5173 --bind 127.0.0.1 --directory dev
//   window 3 (this):    $env:PAYMENT_PROVIDER = "razorpay"; node scripts/manual-tests/razorpay-real.manual.js <step>
// Steps:
//   start            place an order; prints the checkout link to open in the browser
//   verify [file]    report the browser's result (default: Downloads\razorpay_payment.json),
//                    after first trying a forged copy of it
//   reconcile        instead of verify (the closed-tab case): the status job asks Razorpay
//   refund           cancel the paid order; the refund job refunds it at Razorpay; run it again
// Prints ids and statuses only: the key secret is never read here except by the gateway client.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const config = require('../../src/config');
const { pool } = require('../../src/db');
const { call, show, note, login, placeOrder } = require('./_http');

const STATE = path.join(os.tmpdir(), 'tiffin-razorpay-run.json'); // ids only, nothing secret
const step = process.argv[2];

async function main() {
  if (config.PAYMENT_PROVIDER !== 'razorpay' || !config.RAZORPAY_KEY_ID?.startsWith('rzp_test_')) {
    throw new Error('set PAYMENT_PROVIDER=razorpay in this window, with test keys (rzp_test_…) in .env');
  }
  const customer = await login('seed.customer@example.com', process.env.SEED_PASSWORD);
  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : null;
  const getOrder = async (id) => (await call('GET', `/orders/${id}`, { token: customer.token })).json.order;

  if (step === 'start') {
    const home = (await call('GET', '/addresses', { token: customer.token })).json.addresses.find((a) => a.label === 'Home');
    const kora = (await pool.query("SELECT id FROM restaurants WHERE name = 'Seed Koramangala Kitchen'")).rows[0].id;
    const thali = (await pool.query("SELECT id FROM menu_items WHERE restaurant_id = $1 AND name = 'Veg Thali'", [kora])).rows[0].id;
    const placed = await placeOrder(customer.token, { restaurantId: kora, addressId: home.id, items: [{ menuItemId: thali, quantity: 1 }] });
    const { order, payment } = placed.json;
    show('RZ1', 'place an order (server in razorpay mode)', placed, `→ order ${order?.id} ${order?.status}`);
    if (payment?.provider !== 'razorpay') throw new Error('the server is not using Razorpay: start it with PAYMENT_PROVIDER=razorpay');
    note(`Razorpay order ${payment.gatewayOrderId} for ${payment.amountPaise} paise (order total ${order.totalPaise})`);
    fs.writeFileSync(STATE, JSON.stringify({ orderId: order.id, gatewayOrderId: payment.gatewayOrderId }));
    console.log(`\nOpen this link, pay, then download the result:\n  http://localhost:5173/razorpay-checkout.html?key=${payment.keyId}&order=${payment.gatewayOrderId}&amount=${payment.amountPaise}`);
  } else if (step === 'verify') {
    const file = process.argv[3] ?? path.join(os.homedir(), 'Downloads', 'razorpay_payment.json');
    const paid = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (paid.razorpay_order_id !== state?.gatewayOrderId) throw new Error(`${file} is for another Razorpay order`);
    const body = { gatewayPaymentId: paid.razorpay_payment_id, signature: paid.razorpay_signature };
    const flipped = body.signature.slice(0, -1) + (body.signature.endsWith('0') ? '1' : '0');
    show('RZ2', 'verify a forged copy (last signature character changed)', await call('POST', `/orders/${state.orderId}/payment/verify`, { token: customer.token, body: { ...body, signature: flipped } }));
    const real = await call('POST', `/orders/${state.orderId}/payment/verify`, { token: customer.token, body });
    show('RZ3', "verify Razorpay's real result", real, `→ payment ${real.json.payment?.status}, order ${real.json.order?.status}`);
  } else if (step === 'reconcile') {
    const { reconcileAndExpire } = require('../../src/services/paymentService');
    const result = await reconcileAndExpire();
    const order = await getOrder(state.orderId);
    console.log(`RZ4    status job asked Razorpay → ${JSON.stringify(result)}; order ${state.orderId} ${order.status}, last change by ${order.history.at(-1).actor}`);
  } else if (step === 'refund') {
    const { processRefunds } = require('../../src/services/paymentService');
    const { gateway } = require('../../src/payments/gateway');
    const cancelled = await call('POST', `/orders/${state.orderId}/cancel`, { token: customer.token, body: { reason: 'Razorpay test refund' } });
    show('RZ5', 'the customer cancels the paid order', cancelled, `→ refund ${JSON.stringify(cancelled.json.order?.payment?.refund)}`);
    console.log(`RZ6    refund job → ${JSON.stringify(await processRefunds())}`);
    console.log(`RZ7    refund job again → ${JSON.stringify(await processRefunds())}`);
    const r = (await pool.query(
      `SELECT r.id, r.status, r.amount_paise, r.gateway_refund_id, p.gateway_payment_id
       FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE p.order_id = $1`, [state.orderId])).rows[0];
    const atRazorpay = await gateway.findRefund(r.gateway_payment_id, r.id);
    note(`refund ${r.id}: ${r.status}, ${r.amount_paise} paise, Razorpay refund ${r.gateway_refund_id}; Razorpay finds it by our id: ${JSON.stringify(atRazorpay)}`);
  } else {
    console.error('usage: node scripts/manual-tests/razorpay-real.manual.js start | verify [file] | reconcile | refund');
    process.exitCode = 1;
  }
}

main()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => pool.end());

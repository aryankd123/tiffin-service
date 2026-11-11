// HTTP helpers for API tests: requests go through the whole Express app (middleware,
// validation, services, Postgres) without opening a port.
const crypto = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { PASSWORD } = require('./world');

const app = createApp();

// call('POST', '/addresses', { token, body, headers }) → supertest response (status, body, headers)
function call(method, path, { token, body, headers = {} } = {}) {
  let req = request(app)[method.toLowerCase()](`/api/v1${path}`);
  if (token) req = req.set('Authorization', `Bearer ${token}`);
  for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
  return body === undefined ? req : req.send(body);
}

async function login(email, password = PASSWORD) {
  const res = await call('POST', '/auth/login', { body: { email, password } });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return { id: res.body.user.id, token: res.body.accessToken, refreshToken: res.body.refreshToken, user: res.body.user };
}

let n = 0;
async function registerUser(prefix = 'user') {
  const email = `${prefix}.${++n}.${crypto.randomBytes(3).toString('hex')}@example.com`;
  const res = await call('POST', '/auth/register', { body: { name: prefix, email, password: PASSWORD } });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { id: res.body.user.id, email, token: res.body.accessToken, refreshToken: res.body.refreshToken };
}

const errorCode = (res) => res.body?.error?.code;

// Orders need an Idempotency-Key; a fresh one per call unless a test passes its own.
const placeOrder = (token, body, key = crypto.randomUUID()) =>
  call('POST', '/orders', { token, body, headers: { 'Idempotency-Key': key } });

// The fake gateway lives in this process (the same module the app uses), so a test can play
// the customer paying in the checkout window, then report the result like the browser would.
function pay(token, path, payment, status = 'captured') {
  const { gateway } = require('../../src/payments/gateway');
  const paid = gateway.simulatePayment(payment.gatewayOrderId, { status });
  return call('POST', `${path}/payment/verify`, { token, body: paid });
}

async function placePaidOrder(token, body) {
  const placed = await placeOrder(token, body);
  if (placed.status !== 201) throw new Error(`order failed: ${placed.status} ${JSON.stringify(placed.body)}`);
  const verified = await pay(token, `/orders/${placed.body.order.id}`, placed.body.payment);
  if (verified.status !== 200) throw new Error(`payment failed: ${verified.status} ${JSON.stringify(verified.body)}`);
  return verified.body.order;
}

async function subscribePaid(token, body) {
  const created = await call('POST', '/subscriptions', { token, body });
  if (created.status !== 201) throw new Error(`subscribe failed: ${created.status} ${JSON.stringify(created.body)}`);
  const verified = await pay(token, `/subscriptions/${created.body.subscription.id}`, created.body.payment);
  if (verified.status !== 200) throw new Error(`payment failed: ${verified.status} ${JSON.stringify(verified.body)}`);
  return verified.body.subscription;
}

module.exports = {
  app, call, login, registerUser, errorCode, placeOrder, pay, placePaidOrder, subscribePaid,
};

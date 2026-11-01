// Shared helpers for the manual test scripts. Prints only token prefixes, never full tokens.
const crypto = require('node:crypto');

const BASE = 'http://localhost:3000/api/v1';

async function call(method, url, { body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const t0 = performance.now();
  const res = await fetch(BASE + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ms = performance.now() - t0;
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : ''; } catch { json = text; }
  return { status: res.status, json, ms };
}

function show(id, label, r, extra = '') {
  const body = r.json?.error ?? r.json;
  console.log(`${id.padEnd(6)} ${label.padEnd(54)} ${String(r.status).padEnd(4)} ${JSON.stringify(body ?? '').slice(0, 170)} ${extra}`);
}

function note(text) {
  console.log(`       ${text}`);
}

async function registerUser(prefix) {
  const ts = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `${prefix}+${ts}@example.com`;
  const r = await call('POST', '/auth/register', {
    body: { name: prefix, email, password: 'correct horse battery' },
  });
  if (r.status !== 201) throw new Error(`register failed: ${JSON.stringify(r.json)}`);
  return { id: r.json.user.id, email, token: r.json.accessToken, refreshToken: r.json.refreshToken };
}

async function login(email, password) {
  const r = await call('POST', '/auth/login', { body: { email, password } });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(r.json)}`);
  return { id: r.json.user.id, token: r.json.accessToken, refreshToken: r.json.refreshToken, user: r.json.user };
}

// POST /orders with an Idempotency-Key header (a fresh UUID unless one is given).
async function placeOrder(token, body, key = crypto.randomUUID()) {
  const res = await fetch(`${BASE}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': key },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json, replayed: res.headers.get('idempotent-replayed') };
}

// Pays for an order through the fake gateway, like a browser finishing Razorpay's checkout
//. Needs PAYMENT_PROVIDER=fake on the server.
async function payOrder(token, orderId, payment) {
  const paid = await call('POST', '/dev/fake-gateway/pay', { token, body: { gatewayOrderId: payment.gatewayOrderId } });
  return call('POST', `/orders/${orderId}/payment/verify`, { token, body: paid.json });
}

async function placePaidOrder(token, body) {
  const placed = await placeOrder(token, body);
  await payOrder(token, placed.json.order.id, placed.json.payment);
  return placed;
}

module.exports = { call, show, note, registerUser, login, placeOrder, payOrder, placePaidOrder };

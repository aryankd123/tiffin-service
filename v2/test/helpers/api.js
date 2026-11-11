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

module.exports = { app, call, login, registerUser, errorCode };

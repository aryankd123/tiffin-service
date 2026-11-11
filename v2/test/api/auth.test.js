// Registration, login, access tokens, refresh-token rotation, logout and roles (B1-B6).
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const config = require('../../src/config');
const { pool } = require('../../src/db');
const { call, errorCode } = require('../helpers/api');
const { resetWorld, PASSWORD } = require('../helpers/world');

const decode = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
const signAs = (userId, opts) => jwt.sign({ role: 'customer' }, config.JWT_SECRET, {
  algorithm: 'HS256', subject: String(userId), issuer: 'tiffin-api', audience: 'tiffin-client', expiresIn: 60, ...opts,
});

let reg;
const email = 'new.user@example.com';

beforeAll(async () => {
  await resetWorld();
});

describe('register (B1)', () => {
  test('trims and lowercases the email, ignores a role sent by the client', async () => {
    const res = await call('POST', '/auth/register', {
      body: { name: 'New User', email: `  ${email.toUpperCase()}  `, password: PASSWORD, role: 'admin' },
    });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email, role: 'customer' });
    expect(res.body.refreshToken).toEqual(expect.any(String));
    const payload = decode(res.body.accessToken);
    expect(payload.exp - payload.iat).toBe(config.ACCESS_TOKEN_TTL_SECONDS);
    expect(payload).toMatchObject({ role: 'customer', iss: 'tiffin-api', aud: 'tiffin-client' });
    reg = res.body;
  });

  test('the same email in another case is taken', async () => {
    const res = await call('POST', '/auth/register', { body: { name: 'X', email: email.replace('new', 'NEW'), password: PASSWORD } });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('EMAIL_TAKEN');
  });

  test.each([
    ['a bad email and a short password', { name: 'X', email: 'not-an-email', password: 'short' }],
    ['a 73-byte password (bcrypt only reads 72)', { name: 'X', email: 'a@example.com', password: 'a'.repeat(73) }],
    ['30 Hindi characters = 90 bytes', { name: 'X', email: 'b@example.com', password: 'नमस्ते'.repeat(5) }],
  ])('rejects %s', async (_label, body) => {
    const res = await call('POST', '/auth/register', { body });
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('VALIDATION_ERROR');
  });

  test('rejects a request with no body', async () => {
    expect((await call('POST', '/auth/register')).status).toBe(400);
  });
});

describe('login (B2)', () => {
  test('the right password logs in', async () => {
    const res = await call('POST', '/auth/login', { body: { email, password: PASSWORD } });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
  });

  test('a wrong password and an unknown email give the same answer', async () => {
    const wrong = await call('POST', '/auth/login', { body: { email, password: 'wrong password' } });
    const unknown = await call('POST', '/auth/login', { body: { email: 'nobody@example.com', password: 'wrong password' } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });
});

describe('access tokens (B3)', () => {
  test('/me needs a token', async () => {
    const res = await call('GET', '/me');
    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('NOT_AUTHENTICATED');
  });

  test('/me with a valid token returns the user', async () => {
    const res = await call('GET', '/me', { token: reg.accessToken });
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(reg.user.id);
  });

  test('a payload edited to role admin fails the signature check', async () => {
    const [h, p, s] = reg.accessToken.split('.');
    const forged = Buffer.from(JSON.stringify({ ...decode(reg.accessToken), role: 'admin' })).toString('base64url');
    expect(p).not.toBe(forged);
    const res = await call('GET', '/me', { token: `${h}.${forged}.${s}` });
    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('INVALID_TOKEN');
  });

  test('alg "none" with no signature is refused', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ ...decode(reg.accessToken), role: 'admin' })).toString('base64url');
    const res = await call('GET', '/me', { token: `${header}.${payload}.` });
    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('INVALID_TOKEN');
  });

  test('a correctly signed but expired token is refused', async () => {
    const res = await call('GET', '/me', { token: signAs(reg.user.id, { expiresIn: -10 }) });
    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('TOKEN_EXPIRED');
  });

  test('a token for another audience is refused', async () => {
    const res = await call('GET', '/me', { token: signAs(reg.user.id, { audience: 'some-other-service' }) });
    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('INVALID_TOKEN');
  });
});

describe('refresh-token rotation and reuse detection (B4)', () => {
  const refresh = (refreshToken) => call('POST', '/auth/refresh', { body: { refreshToken } });

  test('a reused refresh token revokes the whole family', async () => {
    const R1 = reg.refreshToken;
    const r2 = await refresh(R1);
    expect(r2.status).toBe(200);
    const r3 = await refresh(r2.body.refreshToken);
    expect(r3.status).toBe(200);
    expect(r3.body.refreshToken).not.toBe(r2.body.refreshToken);

    expect((await refresh(R1)).status).toBe(401); // a stolen copy is replayed
    expect((await refresh(r3.body.refreshToken)).status).toBe(401); // so the newest one dies too

    // The registration's family (R1, R2, R3) is fully revoked; the session from the login
    // test above is a separate family and stays active.
    const { rows } = await pool.query(
      `SELECT family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $2) AS stolen,
              count(*)::int AS tokens, count(revoked_at)::int AS revoked
       FROM refresh_tokens WHERE user_id = $1 GROUP BY family_id ORDER BY stolen DESC`,
      [reg.user.id, crypto.createHash('sha256').update(R1).digest('hex')]);
    expect(rows).toEqual([
      { stolen: true, tokens: 3, revoked: 3 },
      { stolen: false, tokens: 1, revoked: 0 },
    ]);
  });

  test('an unknown token is refused', async () => {
    const res = await refresh('garbage');
    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('INVALID_REFRESH_TOKEN');
  });

  test('only a SHA-256 hash of each token is stored', async () => {
    const { rows } = await pool.query('SELECT token_hash FROM refresh_tokens WHERE user_id = $1', [reg.user.id]);
    for (const r of rows) expect(r.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows.map((r) => r.token_hash)).not.toContain(reg.refreshToken);
  });
});

describe('logout (B5)', () => {
  test('revokes the refresh token, is idempotent, and leaves the access token valid until it expires', async () => {
    const session = (await call('POST', '/auth/login', { body: { email, password: PASSWORD } })).body;
    expect((await call('POST', '/auth/logout', { body: { refreshToken: session.refreshToken } })).status).toBe(204);
    expect((await call('POST', '/auth/refresh', { body: { refreshToken: session.refreshToken } })).status).toBe(401);
    expect((await call('POST', '/auth/logout', { body: { refreshToken: session.refreshToken } })).status).toBe(204);
    // Stateless JWT: the 15-minute access token still works (the accepted trade-off).
    expect((await call('GET', '/me', { token: session.accessToken })).status).toBe(200);
  });
});

describe('roles (B6)', () => {
  const city = { name: 'Mysuru', state: 'Karnataka', centre: { lat: 12.2958, lng: 76.6394 } };

  test('no token → 401, customer → 403', async () => {
    const session = (await call('POST', '/auth/login', { body: { email, password: PASSWORD } })).body;
    expect((await call('POST', '/cities', { body: city })).status).toBe(401);
    const res = await call('POST', '/cities', { token: session.accessToken, body: city });
    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe('FORBIDDEN');
  });

  test('after a promotion the old token keeps the old role; a refreshed token has the new one', async () => {
    const session = (await call('POST', '/auth/login', { body: { email, password: PASSWORD } })).body;
    await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [session.user.id]);

    expect((await call('POST', '/cities', { token: session.accessToken, body: city })).status).toBe(403);
    const refreshed = await call('POST', '/auth/refresh', { body: { refreshToken: session.refreshToken } });
    expect(refreshed.status).toBe(200);
    expect(decode(refreshed.body.accessToken).role).toBe('admin');

    const created = await call('POST', '/cities', { token: refreshed.body.accessToken, body: city });
    expect(created.status).toBe(201);
    const again = await call('POST', '/cities', { token: refreshed.body.accessToken, body: city });
    expect(again.status).toBe(409);
    expect(errorCode(again)).toBe('CITY_EXISTS');
  });
});

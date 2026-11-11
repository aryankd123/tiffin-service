// Sign in with Google (C1-C3). The real google-auth-library checks every token (signature, issuer,
// audience, expiry); only its download of Google's public keys is replaced, by a key pair this
// test generates. So tokens signed with that key are "from Google", anything else is forged,
// and the tests run offline. The client id is the made-up one set in test/setup/env.js.
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { OAuth2Client } = require('google-auth-library');
const { pool } = require('../../src/db');
const { call, registerUser, errorCode } = require('../helpers/api');
const { resetWorld, PASSWORD } = require('../helpers/world');

const TEST_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const KID = 'test-google-key';
const google = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const attacker = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const googlePublicPem = google.publicKey.export({ type: 'spki', format: 'pem' });

function idToken(claims = {}, { key = google.privateKey, kid = KID, algorithm = 'RS256', secret } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: 'https://accounts.google.com', aud: TEST_CLIENT_ID, iat: now, exp: now + 3600, email_verified: true, ...claims };
  return algorithm === 'HS256'
    ? jwt.sign(payload, secret, { algorithm })
    : jwt.sign(payload, key, { algorithm, keyid: kid });
}
const signIn = (token) => call('POST', '/auth/google', { body: { idToken: token } });
const dbUser = async (email) => (await pool.query(
  `SELECT id, google_sub, password_hash IS NOT NULL AS has_password FROM users WHERE lower(email) = lower($1)`, [email])).rows;

beforeAll(async () => {
  await resetWorld();
});

beforeEach(() => {
  jest.spyOn(OAuth2Client.prototype, 'getFederatedSignonCertsAsync')
    .mockResolvedValue({ certs: { [KID]: googlePublicPem }, res: null });
});
afterEach(() => jest.restoreAllMocks());

describe('Google sign-in switched on or off (C1)', () => {
  test('C1-a: without a configured client id, Google sign-in answers 503', async () => {
    let app; let isolatedPool;
    jest.isolateModules(() => {
      const real = jest.requireActual('../../src/config');
      jest.doMock('../../src/config', () => ({ ...real, GOOGLE_CLIENT_ID: undefined }));
      app = require('../../src/app').createApp();
      isolatedPool = require('../../src/db').pool;
    });
    const res = await request(app).post('/api/v1/auth/google').send({ idToken: 'anything' });
    await isolatedPool.end();
    expect([res.status, errorCode(res)]).toEqual([503, 'GOOGLE_LOGIN_DISABLED']);
  });

  test('C1-b: no body → 400', async () => {
    expect((await call('POST', '/auth/google')).status).toBe(400);
  });
});

describe('token verification (C2)', () => {
  test.each([
    ['not a JWT at all', () => 'not.a.jwt'],
    ["perfect claims, signed with an attacker's key and an unknown key id", () => idToken({ sub: 'x', email: 'victim@gmail.com' }, { key: attacker.privateKey, kid: 'attacker-key' })],
    ["perfect claims, attacker's key but Google's key id", () => idToken({ sub: 'x', email: 'victim@gmail.com' }, { key: attacker.privateKey })],
    ['HS256 with a guessed secret (algorithm confusion)', () => idToken({ sub: 'x', email: 'v@gmail.com' }, { algorithm: 'HS256', secret: 'guessed-secret' })],
    ["Google's key, but issued for another app", () => idToken({ sub: 'x', email: 'v@gmail.com', aud: 'another-app.apps.googleusercontent.com' })],
    ["Google's key, but expired", () => idToken({ sub: 'x', email: 'v@gmail.com', iat: 1000, exp: 2000 })],
    ["Google's key, but another issuer", () => idToken({ sub: 'x', email: 'v@gmail.com', iss: 'https://evil.example.com' })],
  ])('C2: %s → 401', async (_label, make) => {
    const res = await signIn(make());
    expect([res.status, errorCode(res)]).toEqual([401, 'INVALID_GOOGLE_TOKEN']);
  });
});

describe('accounts: find, create, link, conflict (C3)', () => {
  let googleUser; let pwUser;

  test('C3-a: a new verified Google user gets an account with no password', async () => {
    const res = await signIn(idToken({ sub: 'sub-A', email: 'G.New@gmail.com', name: 'Google Newbie' }));
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: 'g.new@gmail.com', role: 'customer' });
    expect(res.body.refreshToken).toEqual(expect.any(String));
    googleUser = res.body.user;
    expect(await dbUser('g.new@gmail.com')).toEqual([{ id: googleUser.id, google_sub: 'sub-A', has_password: false }]);
  });

  test("C3-b-c: the same Google account is found by its id, even if its email changed at Google's end", async () => {
    expect((await signIn(idToken({ sub: 'sub-A', email: 'g.new@gmail.com' }))).body.user.id).toBe(googleUser.id);
    const renamed = await signIn(idToken({ sub: 'sub-A', email: 'renamed@gmail.com' }));
    expect(renamed.body.user).toMatchObject({ id: googleUser.id, email: 'g.new@gmail.com' });
  });

  test('C3-d: a Google-only account has no password to log in with', async () => {
    const res = await call('POST', '/auth/login', { body: { email: 'g.new@gmail.com', password: 'anything at all' } });
    expect([res.status, errorCode(res)]).toEqual([401, 'INVALID_CREDENTIALS']);
  });

  test('C3-e: a password account is linked only when Google has verified the email', async () => {
    pwUser = await registerUser('pw.user');
    const unverified = await signIn(idToken({ sub: 'sub-B', email: pwUser.email, email_verified: false }));
    expect([unverified.status, errorCode(unverified)]).toEqual([403, 'GOOGLE_EMAIL_UNVERIFIED']);
    expect((await dbUser(pwUser.email))[0].google_sub).toBeNull();

    const verified = await signIn(idToken({ sub: 'sub-B', email: pwUser.email }));
    expect(verified.body.user.id).toBe(pwUser.id);
    expect((await dbUser(pwUser.email))[0]).toMatchObject({ google_sub: 'sub-B', has_password: true });
    expect((await call('POST', '/auth/login', { body: { email: pwUser.email, password: PASSWORD } })).status).toBe(200);
  });

  test('C3-f: a different Google account with the same email is a conflict', async () => {
    const res = await signIn(idToken({ sub: 'sub-C', email: pwUser.email }));
    expect([res.status, errorCode(res)]).toEqual([409, 'ACCOUNT_CONFLICT']);
  });

  test('C3-g: a new user with an unverified email is refused, and nothing is created', async () => {
    const res = await signIn(idToken({ sub: 'sub-D', email: 'unverified@gmail.com', email_verified: false }));
    expect([res.status, errorCode(res)]).toEqual([403, 'GOOGLE_EMAIL_UNVERIFIED']);
    expect(await dbUser('unverified@gmail.com')).toEqual([]);
  });

  test('C3-h: three simultaneous first sign-ins create one account', async () => {
    const token = idToken({ sub: 'sub-R', email: 'racer@gmail.com', name: 'Racer' });
    const results = await Promise.all([1, 2, 3].map(() => signIn(token)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(new Set(results.map((r) => r.body.user.id)).size).toBe(1);
    expect(await dbUser('racer@gmail.com')).toHaveLength(1);
  });
});

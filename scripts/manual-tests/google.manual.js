// Google sign-in tests. Needs the server running on :3000 WITHOUT GOOGLE_CLIENT_ID.
// Run from the server folder: node scripts/manual-tests/google.manual.js
// HTTP for the disabled path, in-process calls for verification and the linking logic.
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { pool } = require('../../src/db');
const { verifyGoogleIdToken } = require('../../src/auth/google');
const authService = require('../../src/services/authService');

const BASE = 'http://localhost:3000/api/v1';
const ts = Date.now();
const logStub = { warn: (o, m) => console.log(`    [server log warn] ${m}: ${o.reason}`) };

async function http(method, url, body) {
  const res = await fetch(BASE + url, {
    method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : '' };
}
const line = (label, status, info) => console.log(`${label.padEnd(58)} ${String(status).padEnd(4)} ${JSON.stringify(info).slice(0, 150)}`);
async function expectErr(label, fn) {
  try { const v = await fn(); line(label, 'OK?!', v.user ?? v); }
  catch (e) { line(label, e.status ?? 'ERR', { code: e.code, message: e.message }); }
}
const dbUser = async (email) =>
  (await pool.query('SELECT id, role, google_sub IS NOT NULL AS has_google, password_hash IS NOT NULL AS has_password FROM users WHERE lower(email)=lower($1)', [email])).rows[0];

(async () => {
  console.log('\n=== C1 HTTP, server running WITHOUT GOOGLE_CLIENT_ID');
  let x = await http('POST', '/auth/google', { idToken: 'anything' });
  line('POST /auth/google', x.status, x.json.error);
  x = await http('POST', '/auth/google');
  line('POST /auth/google with no body', x.status, x.json.error?.code);

  console.log('\n=== C2 token verification (in-process, client ID = test value)');
  await expectErr('garbage string', () => verifyGoogleIdToken('not.a.jwt', logStub));
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const now = Math.floor(Date.now() / 1000);
  const forged = jwt.sign(
    { iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID, sub: '1234567890', email: 'victim@gmail.com', email_verified: true, iat: now, exp: now + 3600 },
    privateKey, { algorithm: 'RS256', keyid: 'attacker-key-1' },
  );
  await expectErr('forged RS256 token, correct claims, attacker key', () => verifyGoogleIdToken(forged, logStub));
  const hs = jwt.sign({ iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID, sub: '1', email: 'v@gmail.com' }, 'guessed-secret', { algorithm: 'HS256' });
  await expectErr('HS256 token (algorithm confusion attempt)', () => verifyGoogleIdToken(hs, logStub));

  console.log('\n=== C3 account linking logic (verified profiles simulated)');
  const gEmail = `g.new+${ts}@gmail.com`;
  const subA = `sub-A-${ts}`;
  const first = await authService.loginWithGoogle({ sub: subA, email: gEmail, emailVerified: true, name: 'Google Newbie' });
  line('a. new Google user', 'OK', { ...first.user, db: await dbUser(gEmail) });
  const again = await authService.loginWithGoogle({ sub: subA, email: gEmail, emailVerified: true, name: 'Google Newbie' });
  line('b. same sub again → same user?', again.user.id === first.user.id ? 'SAME' : 'DIFF', { id: again.user.id });
  const changed = await authService.loginWithGoogle({ sub: subA, email: `renamed+${ts}@gmail.com`, emailVerified: true });
  line('c. same sub, Google-side email changed → same user?', changed.user.id === first.user.id ? 'SAME' : 'DIFF', { id: changed.user.id, email: changed.user.email });
  x = await http('POST', '/auth/login', { email: gEmail, password: 'anything at all' });
  line('d. password login for a Google-only account', x.status, x.json.error?.code);

  const pEmail = `pw.user+${ts}@gmail.com`;
  x = await http('POST', '/auth/register', { name: 'Password User', email: pEmail, password: 'correct horse battery' });
  line('e0. register password account', x.status, { id: x.json.user.id, db: await dbUser(pEmail) });
  const pwId = x.json.user.id;
  await expectErr('e1. Google, same email, email_verified=false → no link', () =>
    authService.loginWithGoogle({ sub: `sub-B-${ts}`, email: pEmail, emailVerified: false }));
  const linked = await authService.loginWithGoogle({ sub: `sub-B-${ts}`, email: pEmail, emailVerified: true, name: 'Ignored Name' });
  line('e2. Google, same email, verified → linked to same user?', linked.user.id === pwId ? 'SAME' : 'DIFF', { ...linked.user, db: await dbUser(pEmail) });
  x = await http('POST', '/auth/login', { email: pEmail, password: 'correct horse battery' });
  line('e3. password login still works after linking', x.status, x.json.user?.id);
  await expectErr('f. different Google account, same email', () =>
    authService.loginWithGoogle({ sub: `sub-C-${ts}`, email: pEmail, emailVerified: true }));
  await expectErr('g. brand-new user with unverified email', () =>
    authService.loginWithGoogle({ sub: `sub-D-${ts}`, email: `unverified+${ts}@gmail.com`, emailVerified: false }));

  const raceEmail = `race+${ts}@gmail.com`;
  const racers = await Promise.allSettled([1, 2, 3].map(() =>
    authService.loginWithGoogle({ sub: `sub-R-${ts}`, email: raceEmail, emailVerified: true, name: 'Racer' })));
  const ids = racers.map((p) => (p.status === 'fulfilled' ? p.value.user.id : `ERR ${p.reason.code}`));
  const count = (await pool.query('SELECT count(*) FROM users WHERE google_sub = $1', [`sub-R-${ts}`])).rows[0].count;
  line('h. 3 concurrent first logins, same Google account', 'RACE', { ids, usersCreated: count });

  console.log(`\nTest data: users with emails containing "+${ts}@gmail.com"`);
  await pool.end();
})().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });

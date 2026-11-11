// Auth tests. Needs the server running on :3000.
// Run from the server folder: node scripts/manual-tests/auth.manual.js
const jwt = require('jsonwebtoken');
const config = require('../../src/config');
const { pool } = require('../../src/db');

const BASE = 'http://localhost:3000/api/v1';
const ts = Date.now();
const email = `aryan.test+${ts}@example.com`;
const PW = 'correct horse battery';

async function call(method, url, { body, token, raw } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const t0 = performance.now();
  const res = await fetch(BASE + url, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const ms = performance.now() - t0;
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, ms };
}
const short = (t) => (t ? `${t.slice(0, 12)}…(${t.length} chars)` : t);
const show = (label, r, extra = '') => console.log(`${label.padEnd(44)} ${r.status}  ${JSON.stringify(r.json?.error ?? r.json?.user ?? r.json ?? '').slice(0, 160)} ${extra}`);
const median = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];

(async () => {
  console.log('\n=== B1 register / validation');
  const reg = await call('POST', '/auth/register', { body: { name: 'Aryan Test', email: `  ${email.toUpperCase()}  `, password: PW, role: 'admin' } });
  show('register (upper-case email, role:admin sent)', reg, `access=${short(reg.json.accessToken)} refresh=${short(reg.json.refreshToken)} expiresIn=${reg.json.expiresIn}`);
  const payload = JSON.parse(Buffer.from(reg.json.accessToken.split('.')[1], 'base64url').toString());
  console.log('  decoded JWT payload (readable by anyone):', JSON.stringify(payload), ' lifetime s =', payload.exp - payload.iat);
  show('register same email, different case', await call('POST', '/auth/register', { body: { name: 'X', email: email.replace('aryan', 'ARYAN'), password: PW } }));
  show('register bad email + short password', await call('POST', '/auth/register', { body: { name: 'X', email: 'not-an-email', password: 'short' } }));
  show('register 73-byte password (ascii)', await call('POST', '/auth/register', { body: { name: 'X', email: `a${ts}@example.com`, password: 'a'.repeat(73) } }));
  const hindi = 'नमस्ते'.repeat(5); // 30 chars
  console.log(`  hindi password: ${hindi.length} chars, ${Buffer.byteLength(hindi)} bytes`);
  show('register 30-char Hindi password', await call('POST', '/auth/register', { body: { name: 'X', email: `b${ts}@example.com`, password: hindi } }));
  show('register with no body', await call('POST', '/auth/register'));

  console.log('\n=== B2 login and timing (5 runs each, median)');
  const ok = [], wrong = [], unknown = [];
  let login;
  for (let i = 0; i < 5; i++) {
    login = await call('POST', '/auth/login', { body: { email, password: PW } }); ok.push(login.ms);
    const w = await call('POST', '/auth/login', { body: { email, password: 'wrong password' } }); wrong.push(w.ms);
    const u = await call('POST', '/auth/login', { body: { email: `nobody${ts}@example.com`, password: 'wrong password' } }); unknown.push(u.ms);
    if (i === 0) { show('login correct', login); show('login wrong password', w); show('login unknown email', u); }
  }
  console.log(`  median ms: correct ${median(ok).toFixed(0)} | wrong password ${median(wrong).toFixed(0)} | unknown email ${median(unknown).toFixed(0)}`);

  console.log('\n=== B3 /me and tokens');
  const access = login.json.accessToken;
  show('/me no token', await call('GET', '/me'));
  show('/me valid token', await call('GET', '/me', { token: access }));
  const [h, p, s] = access.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), role: 'admin' })).toString('base64url');
  show('/me payload edited to role:admin', await call('GET', '/me', { token: `${h}.${forgedPayload}.${s}` }));
  const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  show('/me alg:none token, no signature', await call('GET', '/me', { token: `${noneHeader}.${forgedPayload}.` }));
  const expired = jwt.sign({ role: 'customer' }, config.JWT_SECRET, { algorithm: 'HS256', subject: reg.json.user.id, issuer: 'tiffin-api', audience: 'tiffin-client', expiresIn: -10 });
  show('/me correctly signed but expired', await call('GET', '/me', { token: expired }));
  const otherAud = jwt.sign({ role: 'customer' }, config.JWT_SECRET, { algorithm: 'HS256', subject: reg.json.user.id, issuer: 'tiffin-api', audience: 'some-other-service', expiresIn: 60 });
  show('/me signed, wrong audience', await call('GET', '/me', { token: otherAud }));

  console.log('\n=== B4 refresh rotation and reuse detection');
  const R1 = reg.json.refreshToken;
  const r2 = await call('POST', '/auth/refresh', { body: { refreshToken: R1 } });
  show('refresh R1 (first use)', r2, `→ R2=${short(r2.json.refreshToken)}`);
  const R2 = r2.json.refreshToken;
  const r3 = await call('POST', '/auth/refresh', { body: { refreshToken: R2 } });
  show('refresh R2', r3, `→ R3=${short(r3.json.refreshToken)}`);
  const R3 = r3.json.refreshToken;
  show('refresh R1 AGAIN (replayed stolen copy)', await call('POST', '/auth/refresh', { body: { refreshToken: R1 } }));
  show('refresh R3 (newest; family now revoked)', await call('POST', '/auth/refresh', { body: { refreshToken: R3 } }));
  const fam = await pool.query(
    `SELECT family_id, count(*) AS tokens, count(revoked_at) AS revoked
     FROM refresh_tokens WHERE user_id = $1 GROUP BY family_id ORDER BY min(id)`, [reg.json.user.id]);
  console.log('  DB families for this user:', JSON.stringify(fam.rows.map((r) => ({ family: r.family_id.slice(0, 8), tokens: r.tokens, revoked: r.revoked }))));
  show('refresh with garbage token', await call('POST', '/auth/refresh', { body: { refreshToken: 'garbage' } }));
  const hashed = await pool.query('SELECT token_hash FROM refresh_tokens WHERE user_id = $1 LIMIT 1', [reg.json.user.id]);
  console.log(`  stored token_hash sample: ${hashed.rows[0].token_hash.slice(0, 16)}… (${hashed.rows[0].token_hash.length} hex chars = SHA-256), raw tokens never stored`);

  console.log('\n=== B5 logout');
  const L = await call('POST', '/auth/login', { body: { email, password: PW } });
  show('logout', await call('POST', '/auth/logout', { body: { refreshToken: L.json.refreshToken } }));
  show('refresh after logout', await call('POST', '/auth/refresh', { body: { refreshToken: L.json.refreshToken } }));
  show('logout again (idempotent)', await call('POST', '/auth/logout', { body: { refreshToken: L.json.refreshToken } }));
  show('/me with access token after logout', await call('GET', '/me', { token: L.json.accessToken }), '← still valid until exp (stateless)');

  console.log('\n=== B6 roles: 403 vs 401, stale role in token');
  const C = await call('POST', '/auth/login', { body: { email, password: PW } });
  show('POST /cities no token', await call('POST', '/cities', { body: { name: 'X', state: 'Y' } }));
  show('POST /cities as customer', await call('POST', '/cities', { token: C.json.accessToken, body: { name: `Testcity ${ts}`, state: 'Test', centre: { lat: 12.2958, lng: 76.6394 } } }));
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [reg.json.user.id]);
  console.log('  -- promoted test user to admin in DB --');
  show('POST /cities with OLD token (role customer)', await call('POST', '/cities', { token: C.json.accessToken, body: { name: `Testcity ${ts}`, state: 'Test', centre: { lat: 12.2958, lng: 76.6394 } } }));
  const A = await call('POST', '/auth/refresh', { body: { refreshToken: C.json.refreshToken } });
  show('refresh → new token', A, `role in token: ${JSON.parse(Buffer.from(A.json.accessToken.split('.')[1], 'base64url')).role}`);
  show('POST /cities with new admin token', await call('POST', '/cities', { token: A.json.accessToken, body: { name: `Testcity ${ts}`, state: 'Test', centre: { lat: 12.2958, lng: 76.6394 } } }));
  show('POST /cities same city again', await call('POST', '/cities', { token: A.json.accessToken, body: { name: `Testcity ${ts}`, state: 'Test', centre: { lat: 12.2958, lng: 76.6394 } } }));

  console.log(`\nTest data created: user ${reg.json.user.id} (${email}), city "Testcity ${ts}"`);
  await pool.end();
})().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });

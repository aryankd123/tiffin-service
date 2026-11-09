// Test C4: a REAL Google ID token, end to end.
// Needs the server on :3000 WITH GOOGLE_CLIENT_ID in .env, and a fresh token (valid ~1 hour)
// saved by dev/google-signin.html. Never prints the ID token or our tokens.
// Run from the server folder:
//   node scripts/manual-tests/google-real.manual.js "$env:USERPROFILE\Downloads\google_id_token.txt"
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const [mode, tokenPathArg] = process.argv.slice(2);

// Child-process modes: verification inside this process with a changed config or clock.
// Config is read once at startup (frozen), so each variation needs a fresh process.
if (mode === '--wrong-audience' || mode === '--two-hours-later') {
  if (mode === '--wrong-audience') {
    // Set before config loads; dotenv never overrides a variable that is already set.
    process.env.GOOGLE_CLIENT_ID = '000000000000-someotherapp.apps.googleusercontent.com';
  } else {
    // google-auth-library reads the time with `new Date().getTime()`, so shift the Date class.
    const RealDate = Date;
    const shift = 2 * 60 * 60 * 1000;
    global.Date = class extends RealDate {
      constructor(...args) { if (args.length === 0) super(RealDate.now() + shift); else super(...args); }
      static now() { return RealDate.now() + shift; }
    };
  }
  const { verifyGoogleIdToken } = require('../../src/auth/google');
  const token = fs.readFileSync(tokenPathArg, 'utf8').trim();
  verifyGoogleIdToken(token, { warn: (o) => console.log(`  server would log: ${o.reason}`) })
    .then(() => console.log('  ACCEPTED (unexpected)'))
    .catch((e) => console.log(`  ${e.status} ${e.code}`));
  return; // allowed at the top level of a CommonJS module
}

const { pool } = require('../../src/db');
const { call } = require('./_http');

const tokenPath = mode;
const short = (t) => `${t.slice(0, 10)}…(${t.length} chars)`;

(async () => {
  const idToken = fs.readFileSync(tokenPath, 'utf8').trim();
  const [h, p] = idToken.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url'));
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  console.log(`ID token: ${idToken.length} chars · header alg ${header.alg}, kid …${header.kid.slice(-6)} · iss ${claims.iss}`);
  console.log(`          email_verified ${claims.email_verified} · expires ${new Date(claims.exp * 1000).toLocaleString('en-IN')} · lifetime ${(claims.exp - claims.iat) / 60} min`);

  const before = (await pool.query('SELECT count(*)::int AS n FROM users WHERE google_sub = $1', [claims.sub])).rows[0].n;

  console.log('\n=== C4-a real token → POST /auth/google');
  const a = await call('POST', '/auth/google', { body: { idToken } });
  const user = a.json.user;
  console.log(`C4-a   ${a.status}  user ${JSON.stringify({ id: user?.id, role: user?.role, emailDomain: user?.email?.split('@')[1] })} · our access token ${a.json.accessToken ? short(a.json.accessToken) : '-'} · refresh ${a.json.refreshToken ? short(a.json.refreshToken) : '-'}`);
  const row = (await pool.query(
    'SELECT google_sub IS NOT NULL AS has_google, password_hash IS NOT NULL AS has_password, role FROM users WHERE id = $1', [user.id],
  )).rows[0];
  console.log(`       users with this Google sub before: ${before}, now: 1 · DB row ${JSON.stringify(row)}`);
  const me = await call('GET', '/me', { token: a.json.accessToken });
  console.log(`       GET /me with OUR access token: ${me.status}, same id: ${me.json.user?.id === user.id}`);

  console.log('\n=== C4-b same token again');
  const b = await call('POST', '/auth/google', { body: { idToken } });
  const fam = (await pool.query('SELECT count(DISTINCT family_id)::int AS n FROM refresh_tokens WHERE user_id = $1', [user.id])).rows[0].n;
  console.log(`C4-b   ${b.status}  same user: ${b.json.user?.id === user.id} · refresh-token families for this user: ${fam} (one per sign-in)`);

  console.log('\n=== C4-e signature tampered (last character changed) → POST /auth/google');
  const flipped = idToken.slice(0, -1) + (idToken.endsWith('A') ? 'B' : 'A');
  const e = await call('POST', '/auth/google', { body: { idToken: flipped } });
  console.log(`C4-e   ${e.status}  ${e.json.error?.code}`);

  console.log('\n=== C4-f payload edited (email changed), original signature → POST /auth/google');
  const forgedClaims = Buffer.from(JSON.stringify({ ...claims, email: 'someone.else@gmail.com' })).toString('base64url');
  const f = await call('POST', '/auth/google', { body: { idToken: `${h}.${forgedClaims}.${idToken.split('.')[2]}` } });
  console.log(`C4-f   ${f.status}  ${f.json.error?.code}`);

  await pool.end();

  for (const [id, flag, label] of [['C4-c', '--two-hours-later', 'same token, clock moved 2 h ahead (simulated expiry)'],
    ['C4-d', '--wrong-audience', 'same token, server configured with ANOTHER client id']]) {
    console.log(`\n=== ${id} ${label}`);
    process.stdout.write(execFileSync(process.execPath, [__filename, flag, tokenPath], { encoding: 'utf8' }));
  }
})().catch(async (err) => { console.error(err); await pool.end(); process.exit(1); });

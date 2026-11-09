const crypto = require('node:crypto');
const config = require('../config');
const { pool, withTransaction } = require('../db');
const { AppError } = require('../errors');
const { hashPassword, verifyPassword, DUMMY_HASH } = require('../auth/password');
const {
  signAccessToken,
  newRefreshToken,
  hashRefreshToken,
} = require('../auth/tokens');

const PG_UNIQUE_VIOLATION = '23505';

function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

// Creates a refresh-token row (in the given family, or a new one) and returns both tokens.
async function issueTokens(db, user, familyId = crypto.randomUUID()) {
  const refreshToken = newRefreshToken();
  await db.query(
    `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(days => $4))`,
    [user.id, familyId, hashRefreshToken(refreshToken), config.REFRESH_TOKEN_TTL_DAYS],
  );
  return {
    tokenType: 'Bearer',
    accessToken: signAccessToken(user),
    expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
    refreshToken,
  };
}

async function register({ name, email, password }) {
  // Hash before opening the transaction: ~300 ms of CPU shouldn't hold a DB connection.
  const passwordHash = await hashPassword(password);
  try {
    return await withTransaction(async (client) => {
      // Role is never taken from the request body: every self-registered user is a customer.
      const { rows } = await client.query(
        `INSERT INTO users (name, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, name, email, role`,
        [name, email, passwordHash],
      );
      const user = rows[0];
      return { user: publicUser(user), ...(await issueTokens(client, user)) };
    });
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION && err.constraint === 'users_email_lower_idx') {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
    }
    throw err;
  }
}

async function login({ email, password }) {
  // lower(email) matches the expression index users_email_lower_idx, so this is an index lookup.
  const { rows } = await pool.query(
    'SELECT id, name, email, role, password_hash FROM users WHERE lower(email) = lower($1)',
    [email],
  );
  const user = rows[0];

  // Always run one bcrypt compare, so unknown emails and Google-only accounts take as long
  // as a wrong password, and all three return the same error.
  const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !user.password_hash || !ok) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }

  return { user: publicUser(user), ...(await issueTokens(pool, user)) };
}

// Finds or creates the user for a verified Google profile, inside one transaction.
async function findOrCreateGoogleUser(client, profile) {
  // 1. Returning Google user: google_sub is Google's stable id for the account. The email
  //    can change on Google's side; sub never does.
  const bySub = await client.query(
    'SELECT id, name, email, role FROM users WHERE google_sub = $1',
    [profile.sub],
  );
  if (bySub.rows[0]) return bySub.rows[0];

  // Everything below trusts the email address, so Google must have verified it.
  if (!profile.emailVerified) {
    throw new AppError(403, 'GOOGLE_EMAIL_UNVERIFIED', 'Google has not verified this email address');
  }

  // 2. Existing account with this email (e.g. registered with a password): link it.
  //    FOR UPDATE stops two concurrent first logins from both linking.
  const byEmail = await client.query(
    'SELECT id, name, email, role, google_sub FROM users WHERE lower(email) = lower($1) FOR UPDATE',
    [profile.email],
  );
  const existing = byEmail.rows[0];
  if (existing) {
    if (existing.google_sub) {
      // The email belongs to an account already linked to a *different* Google account.
      throw new AppError(409, 'ACCOUNT_CONFLICT', 'This email is linked to another Google account');
    }
    await client.query('UPDATE users SET google_sub = $1 WHERE id = $2', [profile.sub, existing.id]);
    return { id: existing.id, name: existing.name, email: existing.email, role: existing.role };
  }

  // 3. New user: no password_hash; the users_has_login_method CHECK is satisfied by google_sub.
  const name = (profile.name || profile.email.split('@')[0]).slice(0, 100);
  const created = await client.query(
    `INSERT INTO users (name, email, google_sub)
     VALUES ($1, $2, $3)
     RETURNING id, name, email, role`,
    [name, profile.email, profile.sub],
  );
  return created.rows[0];
}

async function loginWithGoogle(profile) {
  const attempt = () =>
    withTransaction(async (client) => {
      const user = await findOrCreateGoogleUser(client, profile);
      return { user: publicUser(user), ...(await issueTokens(client, user)) };
    });

  try {
    return await attempt();
  } catch (err) {
    // Two first-time logins racing: the loser hits a unique violation on google_sub or email.
    // Retrying once finds the row the winner just created.
    if (err.code === PG_UNIQUE_VIOLATION) return attempt();
    throw err;
  }
}

// Rotation: each refresh token works once. Using it revokes it and issues a new one in the
// same family. Presenting an already-revoked token means it was copied, so the whole family
// is revoked and both the thief and the real user must log in again.
async function refresh(refreshToken) {
  const outcome = await withTransaction(async (client) => {
    // FOR UPDATE locks the row so two concurrent refreshes with the same token can't both win.
    const { rows } = await client.query(
      `SELECT t.id, t.family_id, t.expires_at, t.revoked_at,
              u.id AS user_id, u.name, u.email, u.role
       FROM refresh_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = $1
       FOR UPDATE OF t`,
      [hashRefreshToken(refreshToken)],
    );
    const row = rows[0];
    if (!row) return { error: 'INVALID' };

    if (row.revoked_at) {
      await client.query(
        'UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL',
        [row.family_id],
      );
      // Returned, not thrown: throwing would roll back the family revocation above.
      return { error: 'REUSED' };
    }
    if (row.expires_at <= new Date()) return { error: 'EXPIRED' };

    await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [row.id]);
    // Role is re-read from users, so a role change takes effect at the next refresh.
    const user = { id: row.user_id, name: row.name, email: row.email, role: row.role };
    return { user: publicUser(user), ...(await issueTokens(client, user, row.family_id)) };
  });

  if (outcome.error) {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired');
  }
  return outcome;
}

// Idempotent: an unknown or already-revoked token is not an error, so logout can't be used
// to probe which tokens exist.
async function logout(refreshToken) {
  await pool.query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
    [hashRefreshToken(refreshToken)],
  );
}

async function getUserById(id) {
  const { rows } = await pool.query('SELECT id, name, email, role FROM users WHERE id = $1', [id]);
  return rows[0] ? publicUser(rows[0]) : null;
}

module.exports = { register, login, loginWithGoogle, refresh, logout, getUserById };

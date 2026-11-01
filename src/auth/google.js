const { OAuth2Client } = require('google-auth-library');
const config = require('../config');
const { AppError } = require('../errors');

const client = new OAuth2Client();

// Verifies a Google ID token (an RS256 JWT signed by Google) and returns the fields we use.
// verifyIdToken checks the signature against Google's public keys (fetched and cached),
// plus exp, iss (accounts.google.com) and aud (must be OUR client ID).
async function verifyGoogleIdToken(idToken, log) {
  if (!config.GOOGLE_CLIENT_ID) {
    throw new AppError(503, 'GOOGLE_LOGIN_DISABLED', 'Google login is not configured');
  }

  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: config.GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch (err) {
    // Logged for the operator (e.g. expired vs wrong audience vs no network to fetch keys);
    // the client only learns that the token was rejected.
    // Only the short reason before the first ':' is logged. The library appends the whole
    // token or its decoded payload (email, name, Google id) after it, and those must never
    // reach the logs. Found by test C4 on 1 Nov 2026.
    const reason = String(err.message).split(':')[0].slice(0, 120);
    log.warn({ reason }, 'google id token rejected');
    throw new AppError(401, 'INVALID_GOOGLE_TOKEN', 'Google sign-in token is invalid');
  }

  if (!payload?.sub || !payload.email) {
    throw new AppError(401, 'INVALID_GOOGLE_TOKEN', 'Google sign-in token is missing identity claims');
  }

  return {
    sub: payload.sub,
    email: payload.email.trim().toLowerCase(),
    emailVerified: payload.email_verified === true,
    name: payload.name,
  };
}

module.exports = { verifyGoogleIdToken };

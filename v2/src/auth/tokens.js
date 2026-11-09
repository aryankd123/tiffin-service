const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { AppError } = require('../errors');

const ISSUER = 'tiffin-api';
const AUDIENCE = 'tiffin-client';

// Access token: a short-lived signed JWT, verified without touching the database.
function signAccessToken(user) {
  return jwt.sign({ role: user.role }, config.JWT_SECRET, {
    algorithm: 'HS256',
    subject: String(user.id),
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
  });
}

function verifyAccessToken(token) {
  try {
    // Pinning the algorithm stops a forged token from choosing 'none' or another algorithm.
    const payload = jwt.verify(token, config.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return { id: payload.sub, role: payload.role };
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new AppError(401, 'TOKEN_EXPIRED', 'Access token has expired');
    }
    throw new AppError(401, 'INVALID_TOKEN', 'Access token is invalid');
  }
}

// Refresh token: 256 random bits, opaque to the client. Only its SHA-256 hash is stored.
// A fast hash is fine here (unlike passwords) because the input is random, not guessable.
function newRefreshToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = { signAccessToken, verifyAccessToken, newRefreshToken, hashRefreshToken };

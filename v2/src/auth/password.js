const bcrypt = require('bcrypt');
const config = require('../config');

async function hashPassword(plain) {
  return bcrypt.hash(plain, config.BCRYPT_COST);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// Login compares against this when the email is unknown, so "no such user" takes as long
// as "wrong password" and response time doesn't reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-real-password', config.BCRYPT_COST);

module.exports = { hashPassword, verifyPassword, DUMMY_HASH };

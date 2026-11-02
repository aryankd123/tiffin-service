const pino = require('pino');
const config = require('./config');

const logger = pino({
  level: config.NODE_ENV === 'test' ? 'silent' : 'info',
  redact: {
    // Credentials sent in headers. The webhook signature isn't a secret on its own, but it is the
    // proof of a request and has no place in logs (found by a log check).
    paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]',
      'req.headers["x-razorpay-signature"]'],
    censor: '[REDACTED]',
  },
});

module.exports = logger;

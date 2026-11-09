const { ZodError } = require('zod');
const { AppError } = require('../errors');

function notFound(req, res) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` },
  });
}

// Express recognises an error handler only by its four parameters, so `next` must stay
// in the signature even when unused.
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
  }

  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  // Errors raised by express.json() carry a `type` field.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' },
    });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
    });
  }

  // Unknown error: log the real thing, tell the client nothing internal.
  req.log.error({ err }, 'unhandled error');
  return res.status(500).json({
    error: { code: 'INTERNAL', message: 'Something went wrong' },
  });
}

module.exports = { notFound, errorHandler };

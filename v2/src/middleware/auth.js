const { AppError } = require('../errors');
const { verifyAccessToken } = require('../auth/tokens');

// 401: we don't know who you are. Sets req.user = { id, role } on success.
function requireAuth(req, res, next) {
  const header = req.get('authorization');
  if (!header || !header.startsWith('Bearer ')) {
    throw new AppError(401, 'NOT_AUTHENTICATED', 'Missing bearer token');
  }
  req.user = verifyAccessToken(header.slice('Bearer '.length));
  next();
}

// 403: we know who you are, and you're not allowed. Use after requireAuth.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have permission for this action');
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };

const { withTransaction } = require('../db');
const { AppError } = require('../errors');

// Admins change roles through the API. The user's refresh tokens are revoked in the same
// transaction, so a demoted admin can't mint new admin tokens; their current access token
// still works until it expires (at most 15 minutes).
async function changeRole(actor, userId, role) {
  if (actor.id === userId) {
    // Stops the last admin from locking everyone out by demoting themselves.
    throw new AppError(409, 'CANNOT_CHANGE_OWN_ROLE', 'Admins cannot change their own role');
  }
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      'UPDATE users SET role = $2 WHERE id = $1 RETURNING id, name, email, role',
      [userId, role],
    );
    if (!rows[0]) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    const revoked = await client.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId],
    );
    return { user: rows[0], sessionsRevoked: revoked.rowCount };
  });
}

module.exports = { changeRole };

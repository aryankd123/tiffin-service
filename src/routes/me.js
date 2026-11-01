const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { AppError } = require('../errors');
const authService = require('../services/authService');

const router = express.Router();

// Reads the user from the database rather than trusting the token, so the response shows
// the current name and role even if they changed after the token was issued.
router.get('/', requireAuth, async (req, res) => {
  const user = await authService.getUserById(req.user.id);
  if (!user) throw new AppError(401, 'NOT_AUTHENTICATED', 'User no longer exists');
  res.json({ user });
});

module.exports = router;

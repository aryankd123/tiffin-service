const express = require('express');
const { z } = require('zod');
const { requireAuth, requireRole } = require('../middleware/auth');
const { idParam } = require('../validation/common');
const userService = require('../services/userService');

const router = express.Router();

const roleSchema = z.object({ role: z.enum(['customer', 'vendor_admin', 'admin']) });

router.patch('/:id/role', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = z.object({ id: idParam }).parse(req.params);
  const { role } = roleSchema.parse(req.body);
  res.json(await userService.changeRole(req.user, id, role));
});

module.exports = router;

const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../middleware/auth');
const { idParam } = require('../validation/common');
const deliveryService = require('../services/deliveryService');

const router = express.Router();

const statusSchema = z.object({ status: z.enum(['delivered', 'missed']) });

router.patch('/:id/status', requireAuth, async (req, res) => {
  const { id } = z.object({ id: idParam }).parse(req.params);
  const { status } = statusSchema.parse(req.body);
  res.json(await deliveryService.markDelivery(req.user, id, status));
});

module.exports = router;

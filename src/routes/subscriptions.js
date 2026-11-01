const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../middleware/auth');
const { idParam, isoDate, weekdays } = require('../validation/common');
const subscriptionService = require('../services/subscriptionService');

const router = express.Router();
router.use(requireAuth);

const subscribeSchema = z.object({
  planId: idParam,
  addressId: idParam,
  weekdays,                       // e.g. ["mon", "wed", "fri"]
  startDate: isoDate.optional(),  // default: the first date still open
});

const cancelSchema = z.object({ reason: z.string().trim().min(1).max(200).optional() });

// Either one date (a skip) or a range (a pause).
const skipSchema = z.union([
  z.object({ date: isoDate }).strict().transform(({ date }) => ({ from: date, to: date })),
  z.object({ from: isoDate, to: isoDate }).strict(),
]);

const params = z.object({ id: idParam });

router.post('/', async (req, res) => {
  const body = subscribeSchema.parse(req.body);
  res.status(201).json({ subscription: await subscriptionService.subscribe(req.user, body) });
});

router.get('/', async (req, res) => {
  res.json({ subscriptions: await subscriptionService.listMySubscriptions(req.user.id) });
});

router.get('/:id', async (req, res) => {
  const { id } = params.parse(req.params);
  res.json({ subscription: await subscriptionService.getSubscription(req.user, id) });
});

router.post('/:id/cancel', async (req, res) => {
  const { id } = params.parse(req.params);
  const { reason } = cancelSchema.parse(req.body ?? {});
  res.json({ subscription: await subscriptionService.cancelSubscription(req.user, id, reason) });
});

router.post('/:id/skips', async (req, res) => {
  const { id } = params.parse(req.params);
  const range = skipSchema.parse(req.body);
  res.status(201).json(await subscriptionService.addSkips(req.user, id, range));
});

router.delete('/:id/skips/:date', async (req, res) => {
  const { id, date } = z.object({ id: idParam, date: isoDate }).parse(req.params);
  await subscriptionService.removeSkip(req.user, id, date);
  res.status(204).end();
});

module.exports = router;

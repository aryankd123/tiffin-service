const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../middleware/auth');
const { idParam, isoDate, weekdays, paymentVerify } = require('../validation/common');
const subscriptionService = require('../services/subscriptionService');
const paymentService = require('../services/paymentService');

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

// Paid upfront: the subscription starts as 'awaiting_payment' and the checkout
// starts right away. If the gateway is down, the client retries with POST /subscriptions/:id/payment.
router.post('/', async (req, res) => {
  const body = subscribeSchema.parse(req.body);
  const subscription = await subscriptionService.subscribe(req.user, body);
  let payment = null;
  try {
    payment = await paymentService.checkoutForSubscription(req.user, subscription.id);
  } catch (err) {
    if (err.code !== 'PAYMENT_GATEWAY_UNAVAILABLE') throw err;
  }
  res.status(201).json({ subscription, payment });
});

router.get('/', async (req, res) => {
  res.json({ subscriptions: await subscriptionService.listMySubscriptions(req.user.id) });
});

router.get('/:id', async (req, res) => {
  const { id } = params.parse(req.params);
  res.json({ subscription: await subscriptionService.getSubscription(req.user, id) });
});

// Starts or returns the checkout for one of the caller's subscriptions (safe to repeat).
router.post('/:id/payment', async (req, res) => {
  const { id } = params.parse(req.params);
  res.status(201).json({ payment: await paymentService.checkoutForSubscription(req.user, id) });
});

router.post('/:id/payment/verify', async (req, res) => {
  const { id } = params.parse(req.params);
  const body = paymentVerify.parse(req.body);
  const payment = await paymentService.verifySubscriptionPayment(req.user, id, body);
  res.json({ payment, subscription: await subscriptionService.getSubscription(req.user, id) });
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

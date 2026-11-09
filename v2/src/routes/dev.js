// Development-only helpers. Mounted only when NODE_ENV is not 'production' (app.js).
// - The fake gateway's "browser": simulate a customer paying in the checkout window.
// - Run a scheduled job now, inside this process (the fake gateway's memory lives here, so a
//   separate `npm run job` process can't see its payments).
const express = require('express');
const { z } = require('zod');
const { requireAuth, requireRole } = require('../middleware/auth');
const { AppError } = require('../errors');
const { gateway } = require('../payments/gateway');
const paymentService = require('../services/paymentService');
const { cancelUnconfirmedOrders } = require('../jobs/autoCancelOrders');

const router = express.Router();
router.use(requireAuth);

const fakeOnly = (req, res, next) => {
  if (gateway.name !== 'fake') throw new AppError(404, 'NOT_FOUND', 'Only available with PAYMENT_PROVIDER=fake');
  next();
};

router.post('/fake-gateway/pay', fakeOnly, (req, res) => {
  const { gatewayOrderId, status } = z.object({
    gatewayOrderId: z.string().min(1).max(100),
    status: z.enum(['captured', 'authorized']).default('captured'),
  }).parse(req.body);
  const result = gateway.simulatePayment(gatewayOrderId, { status });
  if (!result) throw new AppError(404, 'GATEWAY_ORDER_NOT_FOUND', 'Unknown gateway order (the fake forgets on restart)');
  res.json(result); // { gatewayPaymentId, signature }: what Razorpay's checkout returns
});

const JOBS = {
  payments: () => paymentService.reconcileAndExpire(),
  refunds: () => paymentService.processRefunds(),
  'auto-cancel': () => cancelUnconfirmedOrders(),
};

router.post('/jobs/:job', requireRole('admin'), async (req, res) => {
  const { job } = z.object({ job: z.enum(Object.keys(JOBS)) }).parse(req.params);
  res.json({ job, result: await JOBS[job]() });
});

module.exports = router;

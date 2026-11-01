const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../middleware/auth');
const { idParam } = require('../validation/common');
const orderService = require('../services/orderService');
const paymentService = require('../services/paymentService');

const router = express.Router();
router.use(requireAuth);

// Required on every POST /orders. A UUID is typical; 8-100 safe characters accepted.
const headerSchema = z.object({
  'idempotency-key': z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,100}$/, 'must be 8-100 letters, digits, "-" or "_"'),
});

// Only ids and quantities: prices and totals sent by the client are not part of the schema,
// so zod drops them.
const placeSchema = z.object({
  restaurantId: idParam,
  addressId: idParam,
  items: z
    .array(z.object({
      menuItemId: idParam,
      quantity: z.number().int().min(1).max(20), // same range as order_items CHECK
    }))
    .min(1)
    .max(20)
    .refine(
      (items) => new Set(items.map((i) => i.menuItemId)).size === items.length,
      'each menu item may appear only once (use quantity instead)',
    ),
});

router.post('/', async (req, res) => {
  const { 'idempotency-key': key } = headerSchema.parse(req.headers);
  const body = placeSchema.parse(req.body);
  const { order, replayed } = await orderService.placeOrder(req.user.id, key, body);
  // The checkout starts right away. If the gateway is down the order still exists
  // ('awaiting_payment'), and the client retries with POST /orders/:id/payment.
  let payment = null;
  try {
    payment = await paymentService.checkoutForOrder(req.user, order.id);
  } catch (err) {
    if (err.code !== 'PAYMENT_GATEWAY_UNAVAILABLE' && err.code !== 'PAYMENT_NOT_NEEDED') throw err;
  }
  // A replay returns exactly what the first attempt returned (status and body), plus a flag.
  if (replayed) res.set('Idempotent-Replayed', 'true');
  res.status(201).json({ order, payment });
});

const params = z.object({ id: idParam });

// Starts or returns the checkout for one of the caller's orders (safe to repeat).
router.post('/:id/payment', async (req, res) => {
  const { id } = params.parse(req.params);
  res.status(201).json({ payment: await paymentService.checkoutForOrder(req.user, id) });
});

// What Razorpay's checkout hands back to the browser after a successful payment.
const verifySchema = z.object({
  gatewayPaymentId: z.string().min(1).max(100),
  signature: z.string().regex(/^[0-9a-f]{64}$/, 'must be a 64-character hex signature'),
});

router.post('/:id/payment/verify', async (req, res) => {
  const { id } = params.parse(req.params);
  const body = verifySchema.parse(req.body);
  const payment = await paymentService.verifyOrderPayment(req.user, id, body);
  res.json({ payment, order: await orderService.getOrder(req.user, id) });
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(200).optional(),
});

// Forward moves only; cancelling has its own endpoint because its rules differ.
const statusSchema = z.object({
  status: z.enum(['confirmed', 'preparing', 'out_for_delivery', 'delivered']),
});

const cancelSchema = z.object({
  reason: z.string().trim().min(1).max(200).optional(),
});

// The caller's own orders, newest first.
router.get('/', async (req, res) => {
  const query = listQuery.parse(req.query);
  res.json(await orderService.listCustomerOrders(req.user.id, query));
});

router.get('/:id', async (req, res) => {
  const { id } = params.parse(req.params);
  res.json({ order: await orderService.getOrder(req.user, id) });
});

router.patch('/:id/status', async (req, res) => {
  const { id } = params.parse(req.params);
  const { status } = statusSchema.parse(req.body);
  res.json({ order: await orderService.advanceStatus(req.user, id, status) });
});

// No body is fine: in Express 5 req.body is then undefined, so default to {}.
router.post('/:id/cancel', async (req, res) => {
  const { id } = params.parse(req.params);
  const { reason } = cancelSchema.parse(req.body ?? {});
  res.json({ order: await orderService.cancelOrder(req.user, id, reason) });
});

module.exports = router;

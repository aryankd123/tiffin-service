const express = require('express');
const { z } = require('zod');
const { requireAuth, requireRole } = require('../middleware/auth');
const { idParam, location, optionalText, isoDate } = require('../validation/common');
const restaurantService = require('../services/restaurantService');
const orderService = require('../services/orderService');
const planService = require('../services/planService');
const deliveryService = require('../services/deliveryService');

const router = express.Router();
const vendorOnly = [requireAuth, requireRole('vendor_admin', 'admin')];

const name = z.string().trim().min(1).max(100);
// Same bounds as restaurants_delivery_radius_m_check: a 400 here instead of a DB error.
const deliveryRadiusM = z.number().int().min(500).max(15000);
// ₹1 to ₹1,00,000 per item, in integer paise.
const pricePaise = z.number().int().min(100).max(10000000);
// ₹0 to ₹200, the same bounds as restaurants_delivery_fee_range.
const deliveryFeePaise = z.number().int().min(0).max(20000);

const discoverQuery = z.object({
  addressId: idParam,
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const createSchema = z.object({
  name,
  cityId: idParam,
  location,
  deliveryRadiusM,
  deliveryFeePaise: deliveryFeePaise.default(0),
});

const patchSchema = z
  .object({
    name: name.optional(),
    deliveryRadiusM: deliveryRadiusM.optional(),
    deliveryFeePaise: deliveryFeePaise.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((p) => Object.values(p).some((v) => v !== undefined), 'at least one field is required');

const menuItemSchema = z.object({
  name,
  description: optionalText(500),
  pricePaise,
  isVegetarian: z.boolean().default(false),
  isAvailable: z.boolean().default(true),
});

const menuPatchSchema = z
  .object({
    name: name.optional(),
    description: optionalText(500),
    pricePaise: pricePaise.optional(),
    isVegetarian: z.boolean().optional(),
    isAvailable: z.boolean().optional(),
  })
  .strict()
  .refine((p) => Object.values(p).some((v) => v !== undefined), 'at least one field is required');

const params = z.object({ id: idParam });
const itemParams = z.object({ id: idParam, itemId: idParam });

// Discovery needs a saved address of the caller, so it requires login.
router.get('/', requireAuth, async (req, res) => {
  const { addressId, limit } = discoverQuery.parse(req.query);
  res.json(await restaurantService.discover(req.user.id, addressId, limit));
});

router.post('/', ...vendorOnly, async (req, res) => {
  const body = createSchema.parse(req.body);
  res.status(201).json({ restaurant: await restaurantService.createRestaurant(req.user, body) });
});

router.get('/:id', async (req, res) => {
  const { id } = params.parse(req.params);
  res.json({ restaurant: await restaurantService.getPublicRestaurant(id) });
});

router.patch('/:id', ...vendorOnly, async (req, res) => {
  const { id } = params.parse(req.params);
  const patch = patchSchema.parse(req.body);
  res.json({ restaurant: await restaurantService.updateRestaurant(req.user, id, patch) });
});

// Subscription plans: a number of meals for one meal slot.
const planSchema = z.object({
  name,
  description: optionalText(500),
  mealSlot: z.enum(['lunch', 'dinner']),
  mealsCount: z.number().int().min(1).max(60),
  pricePaise: z.number().int().min(100).max(5000000), // the whole plan: ₹1 to ₹50,000
});

const planPatchSchema = z
  .object({
    name: name.optional(),
    description: optionalText(500),
    pricePaise: z.number().int().min(100).max(5000000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((p) => Object.values(p).some((v) => v !== undefined), 'at least one field is required');

const planParams = z.object({ id: idParam, planId: idParam });

router.get('/:id/plans', async (req, res) => {
  const { id } = params.parse(req.params);
  res.json({ plans: await planService.listPublicPlans(id) });
});

router.post('/:id/plans', ...vendorOnly, async (req, res) => {
  const { id } = params.parse(req.params);
  const body = planSchema.parse(req.body);
  res.status(201).json({ plan: await planService.createPlan(req.user, id, body) });
});

router.patch('/:id/plans/:planId', ...vendorOnly, async (req, res) => {
  const { id, planId } = planParams.parse(req.params);
  const patch = planPatchSchema.parse(req.body);
  res.json({ plan: await planService.updatePlan(req.user, id, planId, patch) });
});

// The day's subscription deliveries (head-count) for the owner or an admin.
router.get('/:id/deliveries', ...vendorOnly, async (req, res) => {
  const { id } = params.parse(req.params);
  const { date } = z.object({ date: isoDate }).parse(req.query);
  res.json(await deliveryService.listForRestaurant(req.user, id, date));
});

// The restaurant's incoming orders, newest first, for its owner or an admin.
const restaurantOrdersQuery = z.object({
  status: z.enum(['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(200).optional(),
});

router.get('/:id/orders', ...vendorOnly, async (req, res) => {
  const { id } = params.parse(req.params);
  const query = restaurantOrdersQuery.parse(req.query);
  res.json(await orderService.listRestaurantOrders(req.user, id, query));
});

router.get('/:id/menu', async (req, res) => {
  const { id } = params.parse(req.params);
  res.json({ items: await restaurantService.listMenu(id) });
});

router.post('/:id/menu-items', ...vendorOnly, async (req, res) => {
  const { id } = params.parse(req.params);
  const body = menuItemSchema.parse(req.body);
  res.status(201).json({ item: await restaurantService.addMenuItem(req.user, id, body) });
});

router.patch('/:id/menu-items/:itemId', ...vendorOnly, async (req, res) => {
  const { id, itemId } = itemParams.parse(req.params);
  const patch = menuPatchSchema.parse(req.body);
  res.json({ item: await restaurantService.updateMenuItem(req.user, id, itemId, patch) });
});

module.exports = router;

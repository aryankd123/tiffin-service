const express = require('express');
const { z } = require('zod');
const { requireAuth, requireRole } = require('../middleware/auth');
const { location } = require('../validation/common');
const cityService = require('../services/cityService');

const router = express.Router();

const citySchema = z.object({
  name: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  centre: location,
});

// Public: the address form needs the list of cities that accept addresses.
router.get('/', async (req, res) => {
  res.json({ cities: await cityService.listConfiguredCities() });
});

// Admin only: adding a city is how Tiffin expands, so customers and vendors can't do it.
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const body = citySchema.parse(req.body);
  res.status(201).json({ city: await cityService.createCity(body) });
});

module.exports = router;

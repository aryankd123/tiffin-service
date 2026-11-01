const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../middleware/auth');
const {
  idParam, location, indianMobile, pinCode, optionalText,
} = require('../validation/common');
const addressService = require('../services/addressService');

const router = express.Router();
router.use(requireAuth); // every address route is private

const fields = {
  label: z.string().trim().min(1).max(50),
  contactName: z.string().trim().min(1).max(100),
  contactPhone: indianMobile,
  line1: z.string().trim().min(1).max(200),
  line2: optionalText(200),
  cityId: idParam,
  postalCode: pinCode,
  location,
};

const createSchema = z.object({ ...fields, isDefault: z.boolean().optional() });

// PATCH is strict: an unknown key such as isDefault is rejected rather than silently
// ignored, because the client would wrongly believe it had changed something.
const patchSchema = z
  .object({
    label: fields.label.optional(),
    contactName: fields.contactName.optional(),
    contactPhone: fields.contactPhone.optional(),
    line1: fields.line1.optional(),
    line2: fields.line2,
    cityId: fields.cityId.optional(),
    postalCode: fields.postalCode.optional(),
    location: fields.location.optional(),
  })
  .strict()
  .refine((p) => Object.values(p).some((v) => v !== undefined), 'at least one field is required');

const params = z.object({ id: idParam });

router.get('/', async (req, res) => {
  res.json({ addresses: await addressService.listAddresses(req.user.id) });
});

router.post('/', async (req, res) => {
  const body = createSchema.parse(req.body);
  res.status(201).json({ address: await addressService.createAddress(req.user.id, body) });
});

router.get('/:id', async (req, res) => {
  const { id } = params.parse(req.params);
  res.json({ address: await addressService.getAddress(req.user.id, id) });
});

router.patch('/:id', async (req, res) => {
  const { id } = params.parse(req.params);
  const patch = patchSchema.parse(req.body);
  res.json({ address: await addressService.updateAddress(req.user.id, id, patch) });
});

router.patch('/:id/default', async (req, res) => {
  const { id } = params.parse(req.params);
  res.json({ address: await addressService.setDefaultAddress(req.user.id, id) });
});

router.delete('/:id', async (req, res) => {
  const { id } = params.parse(req.params);
  await addressService.deleteAddress(req.user.id, id);
  res.status(204).end();
});

module.exports = router;

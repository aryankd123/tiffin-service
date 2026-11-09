const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');

const {
  createAddress,
  getUserAddresses,
  updateAddress,
  deleteAddress,
  setDefaultAddress
} = require('../controllers/addressController');

// All routes require authentication
router.use(authenticateToken);

// GET /api/addresses - Get user's addresses
router.get('/', getUserAddresses);

// POST /api/addresses - Create new address
router.post('/', createAddress);

// PUT /api/addresses/:id - Update address
router.put('/:id', updateAddress);

// DELETE /api/addresses/:id - Delete address
router.delete('/:id', deleteAddress);

// PATCH /api/addresses/:id/default - Set as default address
router.patch('/:id/default', setDefaultAddress);

module.exports = router;

const express = require('express');
const OrderController = require('../controllers/orderController');
const authenticateToken = require('../middleware/auth');

const router = express.Router();

console.log('Order routes file loaded'); // Add this

router.post('/', authenticateToken, OrderController.createOrder);

// Add logging to this route
router.get('/my-orders', (req, res) => {
  console.log('=== /my-orders ROUTE HIT ===');
  console.log('Request headers:', req.headers);
  authenticateToken(req, res, () => {
    OrderController.getUserOrders(req, res);
  });
});

module.exports = router;

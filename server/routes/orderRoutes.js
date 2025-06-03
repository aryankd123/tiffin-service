const express = require('express');
const OrderController = require('../controllers/orderController');
const authenticateToken = require('../middleware/auth');
const router = express.Router();

router.post('/', authenticateToken, OrderController.createOrder);
router.get('/my-orders', authenticateToken, OrderController.getUserOrders);

module.exports = router;

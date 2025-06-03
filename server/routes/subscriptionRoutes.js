const express = require('express');
const SubscriptionController = require('../controllers/subscriptionController');
const authenticateToken = require('../middleware/auth');
const router = express.Router();

console.log('Subscription routes file loaded');

// Public routes
router.get('/plans', SubscriptionController.getAllPlans);


// Protected routes (authentication required)
router.post('/', authenticateToken, SubscriptionController.createSubscription);
router.get('/my-subscriptions', authenticateToken, SubscriptionController.getUserSubscriptions);
router.get('/active', authenticateToken, SubscriptionController.getActiveSubscriptions);
router.get('/:id', authenticateToken, SubscriptionController.getSubscription);
router.patch('/:id/status', authenticateToken, SubscriptionController.updateSubscriptionStatus);

module.exports = router;


const Subscription = require('../models/Subscription');

class SubscriptionController {
  // Get all subscription plans
  static async getAllPlans(req, res) {
    try {
      console.log('Getting all subscription plans...');
      const plans = await Subscription.getAllPlans();
      res.json({
        message: 'Subscription plans retrieved successfully',
        data: plans
      });
    } catch (error) {
      console.error('Error fetching subscription plans:', error);
      res.status(500).json({ 
        message: 'Failed to fetch subscription plans',
        error: error.message 
      });
    }
  }

  // Create new subscription
  static async createSubscription(req, res) {
    try {
      console.log('=== CREATE SUBSCRIPTION ===');
      console.log('User from token:', req.user);
      console.log('Subscription data:', req.body);
      
      // Handle different user ID formats (Google vs regular users)
      const user_id = (req.user.userId || req.user.id || req.user.sub);
      
      if (!user_id) {
        console.error('No user ID found in token');
        return res.status(400).json({ message: 'User ID not found in token' });
      }
      
      console.log('Creating subscription for user_id:', user_id);
      
      const subscriptionData = {
        user_id: user_id.toString(),
        ...req.body
      };
      
      const newSubscription = await Subscription.create(subscriptionData);
      console.log('Subscription created successfully:', newSubscription);
      
      res.status(201).json({
        message: 'Subscription created successfully',
        data: newSubscription
      });
    } catch (error) {
      console.error('Error creating subscription:', error);
      res.status(500).json({ 
        message: 'Failed to create subscription',
        error: error.message 
      });
    }
  }

  // Get user's subscriptions
  static async getUserSubscriptions(req, res) {
    try {
      console.log('=== GET USER SUBSCRIPTIONS ===');
      console.log('User from token:', req.user);
      
      // Handle different user ID formats (Google vs regular users)
      const user_id = (req.user.userId || req.user.id || req.user.sub);
      
      if (!user_id) {
        console.error('No user ID found in token');
        return res.status(400).json({ message: 'User ID not found in token' });
      }
      
      console.log('Getting subscriptions for user_id:', user_id);
      
      // Check if Subscription model exists and has getByUserId method
      if (!Subscription || typeof Subscription.getByUserId !== 'function') {
        console.error('Subscription model or getByUserId method not found');
        return res.status(500).json({ 
          message: 'Subscription service unavailable',
          error: 'Model method not found'
        });
      }
      
      const subscriptions = await Subscription.getByUserId(user_id.toString());
      console.log('Subscriptions found:', subscriptions);
      
      res.json({
        message: 'User subscriptions retrieved successfully',
        data: subscriptions || []
      });
    } catch (error) {
      console.error('Error fetching user subscriptions:', error);
      
      // Don't return mock data in production - return proper error
      res.status(500).json({ 
        message: 'Failed to fetch user subscriptions',
        error: error.message,
        data: [] // Return empty array instead of mock data
      });
    }
  }

  // Get user's active subscriptions
  static async getActiveSubscriptions(req, res) {
    try {
      console.log('=== GET ACTIVE SUBSCRIPTIONS ===');
      console.log('User from token:', req.user);
      
      // Handle different user ID formats (Google vs regular users)
      const user_id = (req.user.userId || req.user.id || req.user.sub);
      
      if (!user_id) {
        console.error('No user ID found in token');
        return res.status(400).json({ message: 'User ID not found in token' });
      }
      
      console.log('Getting active subscriptions for user_id:', user_id);
      
      if (!Subscription || typeof Subscription.getActiveByUserId !== 'function') {
        console.error('Subscription model or getActiveByUserId method not found');
        return res.status(500).json({ 
          message: 'Subscription service unavailable',
          error: 'Model method not found'
        });
      }
      
      const subscriptions = await Subscription.getActiveByUserId(user_id.toString());
      console.log('Active subscriptions found:', subscriptions);
      
      res.json({
        message: 'Active subscriptions retrieved successfully',
        data: subscriptions || []
      });
    } catch (error) {
      console.error('Error fetching active subscriptions:', error);
      res.status(500).json({ 
        message: 'Failed to fetch active subscriptions',
        error: error.message 
      });
    }
  }

  // Update subscription status (pause, cancel, reactivate)
  static async updateSubscriptionStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      
      console.log(`=== UPDATE SUBSCRIPTION STATUS ===`);
      console.log(`Updating subscription ${id} status to:`, status);
      console.log('User from token:', req.user);
      
      // Validate status
      const validStatuses = ['active', 'paused', 'cancelled', 'expired'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ 
          message: 'Invalid status',
          validStatuses 
        });
      }
      
      // Handle different user ID formats (Google vs regular users)
      const user_id = (req.user.userId || req.user.id || req.user.sub);
      
      if (!user_id) {
        return res.status(400).json({ message: 'User ID not found in token' });
      }
      
      // Check if methods exist
      if (!Subscription || typeof Subscription.getById !== 'function' || typeof Subscription.updateStatus !== 'function') {
        return res.status(500).json({ 
          message: 'Subscription service unavailable',
          error: 'Model methods not found'
        });
      }
      
      // Verify subscription belongs to user
      const subscription = await Subscription.getById(id);
      if (!subscription) {
        return res.status(404).json({ message: 'Subscription not found' });
      }
      
      if (subscription.user_id.toString() !== user_id.toString()) {
        return res.status(403).json({ message: 'Access denied - subscription does not belong to user' });
      }
      
      const updatedSubscription = await Subscription.updateStatus(id, status);
      console.log('Subscription status updated:', updatedSubscription);
      
      res.json({
        message: 'Subscription status updated successfully',
        data: updatedSubscription
      });
    } catch (error) {
      console.error('Error updating subscription status:', error);
      res.status(500).json({ 
        message: 'Failed to update subscription status',
        error: error.message 
      });
    }
  }

  // Get single subscription details
  static async getSubscription(req, res) {
    try {
      const { id } = req.params;
      console.log('=== GET SUBSCRIPTION DETAILS ===');
      console.log('Getting subscription details for ID:', id);
      console.log('User from token:', req.user);
      
      // Handle different user ID formats (Google vs regular users)
      const user_id = (req.user.userId || req.user.id || req.user.sub);
      
      if (!user_id) {
        return res.status(400).json({ message: 'User ID not found in token' });
      }
      
      if (!Subscription || typeof Subscription.getById !== 'function') {
        return res.status(500).json({ 
          message: 'Subscription service unavailable',
          error: 'Model method not found'
        });
      }
      
      const subscription = await Subscription.getById(id);
      if (!subscription) {
        return res.status(404).json({ message: 'Subscription not found' });
      }
      
      // Verify subscription belongs to user
      if (subscription.user_id.toString() !== user_id.toString()) {
        return res.status(403).json({ message: 'Access denied - subscription does not belong to user' });
      }
      
      console.log('Subscription details retrieved:', subscription);
      
      res.json({
        message: 'Subscription details retrieved successfully',
        data: subscription
      });
    } catch (error) {
      console.error('Error fetching subscription details:', error);
      res.status(500).json({ 
        message: 'Failed to fetch subscription details',
        error: error.message 
      });
    }
  }
}

module.exports = SubscriptionController;

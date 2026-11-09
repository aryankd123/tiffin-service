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
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  // Create new subscription
  static async createSubscription(req, res) {
    try {
      console.log('=== CREATE SUBSCRIPTION ===');
      console.log('User from token:', req.user);
      console.log('Subscription data:', req.body);
      
      // Handle different user ID formats (Google vs regular users)
      const user_id = (req.user.userId || req.user.id || req.user.sub).toString();
      
      if (!user_id) {
        return res.status(400).json({ message: 'User ID not found in token' });
      }
      
      console.log('Creating subscription for user_id:', user_id);
      
      const subscriptionData = {
        user_id: user_id,
        ...req.body
      };
      
      const newSubscription = await Subscription.create(subscriptionData);
      res.status(201).json({
        message: 'Subscription created successfully',
        data: newSubscription
      });
    } catch (error) {
      console.error('Error creating subscription:', error);
      res.status(500).json({ message: 'Internal server error', error: error.message });
    }
  }

  // Get user's subscriptions
  static async getUserSubscriptions(req, res) {
    try {
      console.log('=== GET USER SUBSCRIPTIONS ===');
      console.log('User from token:', req.user);
      
      // Handle different user ID formats (Google vs regular users)
      const user_id = (req.user.userId || req.user.id || req.user.sub).toString();
      
      if (!user_id) {
        return res.status(400).json({ message: 'User ID not found in token' });
      }
      
      console.log('Getting subscriptions for user_id:', user_id);
      
      // Check if Subscription model exists and has getByUserId method
      if (!Subscription || typeof Subscription.getByUserId !== 'function') {
        console.error('Subscription model or getByUserId method not found');
        // Return mock data for testing
        const mockSubscriptions = [
          {
            id: 1,
            user_id: user_id,
            plan_name: 'Basic Plan',
            plan_description: 'Daily lunch delivery',
            plan_price: 150,
            status: 'active',
            start_date: new Date(),
            end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          }
        ];
        return res.json({ 
          message: 'Subscriptions retrieved successfully (mock data)', 
          data: mockSubscriptions 
        });
      }
      
      const subscriptions = await Subscription.getByUserId(user_id);
      console.log('Subscriptions found:', subscriptions);
      
      res.json({
        message: 'User subscriptions retrieved successfully',
        data: subscriptions || []
      });
    } catch (error) {
      console.error('Error fetching user subscriptions:', error);
      
      // Return mock data if there's an error (for testing)
      const user_id = (req.user.userId || req.user.id || req.user.sub).toString();
      const mockSubscriptions = [
        {
          id: 1,
          user_id: user_id,
          plan_name: 'Test Plan',
          plan_description: 'Test subscription',
          plan_price: 150,
          status: 'active',
          start_date: new Date(),
          end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      ];
      
      res.json({ 
        message: 'Using mock data due to error', 
        data: mockSubscriptions,
        error: error.message 
      });
    }
  }

  // Get user's active subscriptions
  static async getActiveSubscriptions(req, res) {
    try {
      console.log('=== GET ACTIVE SUBSCRIPTIONS ===');
      console.log('User from token:', req.user);
      
      // Handle different user ID formats (Google vs regular users)
      const user_id = (req.user.userId || req.user.id || req.user.sub).toString();
      
      if (!user_id) {
        return res.status(400).json({ message: 'User ID not found in token' });
      }
      
      console.log('Getting active subscriptions for user_id:', user_id);
      const subscriptions = await Subscription.getActiveByUserId(user_id);
      res.json({
        message: 'Active subscriptions retrieved successfully',
        data: subscriptions || []
      });
    } catch (error) {
      console.error('Error fetching active subscriptions:', error);
      res.status(500).json({ message: 'Internal server error', error: error.message });
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
      
      // Handle different user ID formats (Google vs regular users)
      const user_id = (req.user.userId || req.user.id || req.user.sub).toString();
      
      // Verify subscription belongs to user
      const subscription = await Subscription.getById(id);
      if (!subscription) {
        return res.status(404).json({ message: 'Subscription not found' });
      }
      
      if (subscription.user_id.toString() !== user_id) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      const updatedSubscription = await Subscription.updateStatus(id, status);
      res.json({
        message: 'Subscription status updated successfully',
        data: updatedSubscription
      });
    } catch (error) {
      console.error('Error updating subscription status:', error);
      res.status(500).json({ message: 'Internal server error', error: error.message });
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
      const user_id = (req.user.userId || req.user.id || req.user.sub).toString();
      
      const subscription = await Subscription.getById(id);
      if (!subscription) {
        return res.status(404).json({ message: 'Subscription not found' });
      }
      
      // Verify subscription belongs to user
      if (subscription.user_id.toString() !== user_id) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      res.json({
        message: 'Subscription details retrieved successfully',
        data: subscription
      });
    } catch (error) {
      console.error('Error fetching subscription details:', error);
      res.status(500).json({ message: 'Internal server error', error: error.message });
    }
  }
}

module.exports = SubscriptionController;

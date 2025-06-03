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
      console.log('Creating new subscription for user:', req.user.id);
      console.log('Subscription data:', req.body);
      
      const subscriptionData = {
        user_id: req.user.id,
        ...req.body
      };
      
      const newSubscription = await Subscription.create(subscriptionData);
      res.status(201).json({
        message: 'Subscription created successfully',
        data: newSubscription
      });
    } catch (error) {
      console.error('Error creating subscription:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  // Get user's subscriptions
  static async getUserSubscriptions(req, res) {
    try {
      console.log('Getting subscriptions for user:', req.user.id);
      const subscriptions = await Subscription.getByUserId(req.user.id);
      res.json({
        message: 'User subscriptions retrieved successfully',
        data: subscriptions
      });
    } catch (error) {
      console.error('Error fetching user subscriptions:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  // Get user's active subscriptions
  static async getActiveSubscriptions(req, res) {
    try {
      console.log('Getting active subscriptions for user:', req.user.id);
      const subscriptions = await Subscription.getActiveByUserId(req.user.id);
      res.json({
        message: 'Active subscriptions retrieved successfully',
        data: subscriptions
      });
    } catch (error) {
      console.error('Error fetching active subscriptions:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  // Update subscription status (pause, cancel, reactivate)
  static async updateSubscriptionStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      
      console.log(`Updating subscription ${id} status to:`, status);
      
      // Verify subscription belongs to user
      const subscription = await Subscription.getById(id);
      if (!subscription) {
        return res.status(404).json({ message: 'Subscription not found' });
      }
      
      if (subscription.user_id !== req.user.id) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      const updatedSubscription = await Subscription.updateStatus(id, status);
      res.json({
        message: 'Subscription status updated successfully',
        data: updatedSubscription
      });
    } catch (error) {
      console.error('Error updating subscription status:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  // Get single subscription details
  static async getSubscription(req, res) {
    try {
      const { id } = req.params;
      console.log('Getting subscription details for ID:', id);
      
      const subscription = await Subscription.getById(id);
      if (!subscription) {
        return res.status(404).json({ message: 'Subscription not found' });
      }
      
      // Verify subscription belongs to user
      if (subscription.user_id !== req.user.id) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      res.json({
        message: 'Subscription details retrieved successfully',
        data: subscription
      });
    } catch (error) {
      console.error('Error fetching subscription details:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
}

module.exports = SubscriptionController;

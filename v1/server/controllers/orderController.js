const Order = require('../models/Order');

class OrderController {
  static async createOrder(req, res) {
    try {
      console.log('=== CREATE ORDER ===');
      console.log('User from token:', req.user);
      console.log('Request body:', req.body);
      
      // Handle different user ID formats
      const user_id = req.user.userId || req.user.id || req.user.sub;
      
      if (!user_id) {
        return res.status(400).json({ message: 'User ID not found in token' });
      }
      
      const { items, total } = req.body;
      
      if (!items || total === undefined) {
        return res.status(400).json({ message: 'Items and total are required' });
      }
      
      console.log('Creating order with user_id:', user_id);
      const order = await Order.create({ 
        user_id, 
        items, 
        total_amount: total  // Map frontend's "total" to "total_amount"
      });
      
      console.log('Order created successfully:', order);
      res.status(201).json({ 
        message: 'Order placed successfully', 
        data: {
          ...order,
          total: order.total_amount  // Frontend compatibility
        }
      });
    } catch (error) {
      console.error('Error in createOrder:', error);
      res.status(500).json({ 
        message: 'Failed to place order', 
        error: error.message 
      });
    }
  }

  static async getUserOrders(req, res) {
    try {
      console.log('=== GET USER ORDERS ===');
      console.log('User from token:', req.user);
      
      const user_id = req.user.userId || req.user.id || req.user.sub;
      
      if (!user_id) {
        return res.status(400).json({ message: 'User ID not found in token' });
      }
      
      console.log('Fetching orders for user_id:', user_id);
      const orders = await Order.getByUserId(user_id);
      
      res.json({ 
        message: 'Orders retrieved successfully', 
        data: orders.map(order => ({
          ...order,
          total: order.total_amount  // Frontend compatibility
        }))
      });
    } catch (error) {
      console.error('Error in getUserOrders:', error);
      res.status(500).json({ 
        message: 'Failed to fetch orders', 
        error: error.message 
      });
    }
  }
}

module.exports = OrderController;

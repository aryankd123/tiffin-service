const Order = require('../models/Order');

class OrderController {
  static async createOrder(req, res) {
    try {
      console.log('=== CREATE ORDER ===');
      console.log('User from token:', req.user);
      console.log('Request body:', req.body);
      
      // Handle different user ID formats (Google vs regular users)
      const user_id = req.user.userId || req.user.id || req.user.sub;
      
      if (!user_id) {
        return res.status(400).json({ message: 'User ID not found in token' });
      }
      
      const { items, total } = req.body;
      
      if (!items || !total) {
        return res.status(400).json({ message: 'Items and total are required' });
      }
      
      console.log('Creating order with user_id:', user_id);
      const order = await Order.create({ user_id, items, total });
      
      console.log('Order created successfully:', order);
      res.status(201).json({ message: 'Order placed successfully', data: order });
    } catch (error) {
      console.error('Error in createOrder:', error);
      res.status(500).json({ message: 'Failed to place order', error: error.message });
    }
  }

  static async getUserOrders(req, res) {
    try {
      console.log('=== GET USER ORDERS ===');
      console.log('User from token:', req.user);
      
      // Handle different user ID formats (Google vs regular users)
      const user_id = req.user.userId || req.user.id || req.user.sub;
      
      if (!user_id) {
        return res.status(400).json({ message: 'User ID not found in token' });
      }
      
      console.log('Fetching orders for user_id:', user_id);
      
      // Check if Order model exists and has getByUserId method
      if (!Order || typeof Order.getByUserId !== 'function') {
        console.error('Order model or getByUserId method not found');
        // Return mock data for testing
        const mockOrders = [
          {
            id: 1,
            user_id: user_id,
            total_amount: 250,
            status: 'delivered',
            created_at: new Date(),
            items: [{ name: 'Dal Rice' }, { name: 'Roti' }]
          },
          {
            id: 2,
            user_id: user_id,
            total_amount: 180,
            status: 'preparing',
            created_at: new Date(),
            items: [{ name: 'Biryani' }]
          }
        ];
        return res.json({ message: 'Orders retrieved successfully (mock data)', data: mockOrders });
      }
      
      const orders = await Order.getByUserId(user_id);
      console.log('Orders found:', orders);
      
      res.json({ message: 'Orders retrieved successfully', data: orders || [] });
    } catch (error) {
      console.error('Error in getUserOrders:', error);
      
      // Return mock data if there's an error (for testing)
      const user_id = req.user.userId || req.user.id || req.user.sub;
      const mockOrders = [
        {
          id: 1,
          user_id: user_id,
          total_amount: 250,
          status: 'delivered',
          created_at: new Date(),
          items: [{ name: 'Dal Rice' }, { name: 'Roti' }]
        }
      ];
      
      res.json({ 
        message: 'Using mock data due to error', 
        data: mockOrders,
        error: error.message 
      });
    }
  }
}

module.exports = OrderController;

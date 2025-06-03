const Order = require('../models/Order');

class OrderController {
  static async createOrder(req, res) {
    try {
      const user_id = req.user.id;
      const { items, total } = req.body;
      const order = await Order.create({ user_id, items, total });
      res.status(201).json({ message: 'Order placed successfully', data: order });
    } catch (error) {
      res.status(500).json({ message: 'Failed to place order', error: error.message });
    }
  }

  static async getUserOrders(req, res) {
    try {
      const user_id = req.user.id;
      const orders = await Order.getByUserId(user_id);
      res.json({ message: 'Orders retrieved successfully', data: orders });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch orders', error: error.message });
    }
  }
}

module.exports = OrderController;

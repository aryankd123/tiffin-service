const MenuItem = require('../models/MenuItem');

class MenuController {
  // Get all menu items
  static async getAllItems(req, res) {
    try {
      console.log('Getting all menu items...');
      const items = await MenuItem.getAll();
      res.json({
        message: 'Menu items retrieved successfully',
        data: items
      });
    } catch (error) {
      console.error('Error fetching menu items:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  // Get menu items by category
  static async getItemsByCategory(req, res) {
    try {
      const { category } = req.params;
      console.log('Getting items for category:', category);
      const items = await MenuItem.getByCategory(category);
      res.json({
        message: `${category} items retrieved successfully`,
        data: items
      });
    } catch (error) {
      console.error('Error fetching menu items by category:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  // Create new menu item (admin only)
  static async createItem(req, res) {
    try {
      console.log('Creating new menu item:', req.body);
      const itemData = req.body;
      const newItem = await MenuItem.create(itemData);
      res.status(201).json({
        message: 'Menu item created successfully',
        data: newItem
      });
    } catch (error) {
      console.error('Error creating menu item:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  // Get single menu item
  static async getItem(req, res) {
    try {
      const { id } = req.params;
      console.log('Getting menu item with ID:', id);
      const item = await MenuItem.getById(id);
      
      if (!item) {
        return res.status(404).json({ message: 'Menu item not found' });
      }

      res.json({
        message: 'Menu item retrieved successfully',
        data: item
      });
    } catch (error) {
      console.error('Error fetching menu item:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
}

module.exports = MenuController;

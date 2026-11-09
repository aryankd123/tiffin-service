const pool = require('../config/database');

class MenuItem {
  // Get all menu items
  static async getAll() {
    const query = 'SELECT * FROM menu_items ORDER BY category, name';
    const result = await pool.query(query);
    return result.rows;
  }

  // Get menu items by category
  static async getByCategory(category) {
    const query = 'SELECT * FROM menu_items WHERE category = $1 ORDER BY name';
    const result = await pool.query(query, [category]);
    return result.rows;
  }

  // Create new menu item
  static async create(itemData) {
    const { name, description, price, category, is_daily, is_vegetarian } = itemData;
    const query = `
      INSERT INTO menu_items (name, description, price, category, is_daily, is_vegetarian)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const result = await pool.query(query, [name, description, price, category, is_daily, is_vegetarian]);
    return result.rows[0];
  }

  // Get menu item by ID
  static async getById(id) {
    const query = 'SELECT * FROM menu_items WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rows[0];
  }
}

module.exports = MenuItem;

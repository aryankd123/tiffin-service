const pool = require('../config/database');

class Order {
  static async create({ user_id, items, total }) {
    const query = `
      INSERT INTO orders (user_id, items, total)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    const result = await pool.query(query, [user_id, JSON.stringify(items), total]);
    return result.rows[0];
  }

  static async getByUserId(user_id) {
    const query = 'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC';
    const result = await pool.query(query, [user_id]);
    return result.rows;
  }
}

module.exports = Order;

const pool = require('../config/database');

class Order {
  static async create({ user_id, items, total_amount }) {
    const query = `
      INSERT INTO orders (user_id, items, total_amount, status)
      VALUES ($1, $2, $3, 'pending')
      RETURNING *
    `;
    const result = await pool.query(query, [
      user_id,
      JSON.stringify(items),
      total_amount
    ]);
    return result.rows[0];
  }

  static async getByUserId(user_id) {
    const query = `
      SELECT *, 
      total_amount AS total  
      FROM orders 
      WHERE user_id = $1 
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query, [user_id]);
    return result.rows;
  }
}

module.exports = Order;

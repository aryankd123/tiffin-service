const pool = require('../config/database');

class Subscription {
  // Create new subscription
  static async create(subscriptionData) {
    const { user_id, plan_id, start_date, end_date, delivery_address } = subscriptionData;
    const query = `
      INSERT INTO subscriptions (user_id, plan_id, start_date, end_date, delivery_address, status)
      VALUES ($1, $2, $3, $4, $5, 'active')
      RETURNING *
    `;
    const result = await pool.query(query, [user_id, plan_id, start_date, end_date, delivery_address]);
    return result.rows[0];
  }

  // Get user's subscriptions
  static async getByUserId(userId) {
    const query = `
      SELECT s.*, sp.name as plan_name, sp.description as plan_description, 
             sp.price as plan_price, sp.days_of_week, sp.is_vegetarian
      FROM subscriptions s
      JOIN subscription_plans sp ON s.plan_id = sp.id
      WHERE s.user_id = $1
      ORDER BY s.start_date DESC
    `;
    const result = await pool.query(query, [userId]);
    return result.rows;
  }

  // Get all subscription plans
  static async getAllPlans() {
    const query = 'SELECT * FROM subscription_plans ORDER BY price';
    const result = await pool.query(query);
    return result.rows;
  }

  // Get subscription by ID
  static async getById(id) {
    const query = `
      SELECT s.*, sp.name as plan_name, sp.description as plan_description, 
             sp.price as plan_price, sp.days_of_week, sp.is_vegetarian
      FROM subscriptions s
      JOIN subscription_plans sp ON s.plan_id = sp.id
      WHERE s.id = $1
    `;
    const result = await pool.query(query, [id]);
    return result.rows[0];
  }

  // Update subscription status
  static async updateStatus(id, status) {
    const query = 'UPDATE subscriptions SET status = $1 WHERE id = $2 RETURNING *';
    const result = await pool.query(query, [status, id]);
    return result.rows[0];
  }

  // Get active subscriptions for a user
  static async getActiveByUserId(userId) {
    const query = `
      SELECT s.*, sp.name as plan_name, sp.description as plan_description, 
             sp.price as plan_price, sp.days_of_week, sp.is_vegetarian
      FROM subscriptions s
      JOIN subscription_plans sp ON s.plan_id = sp.id
      WHERE s.user_id = $1 AND s.status = 'active'
      ORDER BY s.start_date DESC
    `;
    const result = await pool.query(query, [userId]);
    return result.rows;
  }
}

module.exports = Subscription;

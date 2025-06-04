const pool = require('../config/database');

class Subscription {
  // Create new subscription
  static async create(subscriptionData) {
    try {
      const { user_id, plan_id, start_date, end_date, delivery_address } = subscriptionData;
      
      // Get plan details first
      const planQuery = 'SELECT * FROM subscription_plans WHERE id = $1';
      const planResult = await pool.query(planQuery, [plan_id]);
      
      if (planResult.rows.length === 0) {
        throw new Error('Subscription plan not found');
      }
      
      const plan = planResult.rows[0];
      
      const query = `
        INSERT INTO subscriptions (user_id, plan_id, plan_name, plan_description, plan_price, start_date, end_date, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
        RETURNING *
      `;
      
      const result = await pool.query(query, [
        user_id, plan_id, plan.name, plan.description, plan.price, start_date, end_date
      ]);
      
      return result.rows[0];
    } catch (error) {
      console.error('Error creating subscription:', error);
      throw error;
    }
  }

  // Get user's subscriptions - FIXED: Remove non-existent columns
  static async getByUserId(userId) {
    try {
      const query = `
        SELECT s.*, sp.name as plan_name, sp.description as plan_description, 
               sp.price as plan_price, sp.duration_days
        FROM subscriptions s
        JOIN subscription_plans sp ON s.plan_id = sp.id
        WHERE s.user_id = $1
        ORDER BY s.created_at DESC
      `;
      const result = await pool.query(query, [userId]);
      return result.rows;
    } catch (error) {
      console.error('Error in getByUserId:', error);
      throw error;
    }
  }

  // Get all subscription plans
  static async getAllPlans() {
    try {
      const query = 'SELECT id, name, description, price, duration_days, created_at FROM subscription_plans ORDER BY price';
      const result = await pool.query(query);
      return result.rows;
    } catch (error) {
      console.error('Error in getAllPlans:', error);
      throw error;
    }
  }

  // Get subscription by ID - FIXED: Remove non-existent columns
  static async getById(id) {
    try {
      const query = `
        SELECT s.*, sp.name as plan_name, sp.description as plan_description, 
               sp.price as plan_price, sp.duration_days
        FROM subscriptions s
        JOIN subscription_plans sp ON s.plan_id = sp.id
        WHERE s.id = $1
      `;
      const result = await pool.query(query, [id]);
      return result.rows[0];
    } catch (error) {
      console.error('Error in getById:', error);
      throw error;
    }
  }

  // Update subscription status
  static async updateStatus(id, status) {
    try {
      const query = 'UPDATE subscriptions SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *';
      const result = await pool.query(query, [status, id]);
      return result.rows[0];
    } catch (error) {
      console.error('Error in updateStatus:', error);
      throw error;
    }
  }

  // Get active subscriptions for a user - FIXED: Remove non-existent columns
  static async getActiveByUserId(userId) {
    try {
      const query = `
        SELECT s.*, sp.name as plan_name, sp.description as plan_description, 
               sp.price as plan_price, sp.duration_days
        FROM subscriptions s
        JOIN subscription_plans sp ON s.plan_id = sp.id
        WHERE s.user_id = $1 AND s.status = 'active'
        ORDER BY s.created_at DESC
      `;
      const result = await pool.query(query, [userId]);
      return result.rows;
    } catch (error) {
      console.error('Error in getActiveByUserId:', error);
      throw error;
    }
  }
}

module.exports = Subscription;

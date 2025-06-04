const pool = require('../config/database');

class Address {
  static async create(addressData) {
    try {
      const { user_id, title, full_address, city, state, postal_code, country, is_default } = addressData;
      
      // If this is set as default, unset all other defaults for this user
      if (is_default) {
        await pool.query('UPDATE addresses SET is_default = false WHERE user_id = $1', [user_id]);
      }
      
      const query = `
        INSERT INTO addresses (user_id, title, full_address, city, state, postal_code, country, is_default)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `;
      
      const result = await pool.query(query, [
        user_id, title, full_address, city, state, postal_code, country || 'India', is_default || false
      ]);
      
      return result.rows[0];
    } catch (error) {
      console.error('Error creating address:', error);
      throw error;
    }
  }

  static async getByUserId(userId) {
    try {
      const query = 'SELECT * FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC';
      const result = await pool.query(query, [userId.toString()]);
      return result.rows;
    } catch (error) {
      console.error('Error fetching addresses:', error);
      throw error;
    }
  }

  static async update(addressId, userId, updateData) {
    try {
      const { title, full_address, city, state, postal_code, country, is_default } = updateData;
      
      // If this is set as default, unset all other defaults for this user
      if (is_default) {
        await pool.query('UPDATE addresses SET is_default = false WHERE user_id = $1', [userId]);
      }
      
      const query = `
        UPDATE addresses 
        SET title = $1, full_address = $2, city = $3, state = $4, postal_code = $5, 
            country = $6, is_default = $7, updated_at = CURRENT_TIMESTAMP
        WHERE id = $8 AND user_id = $9
        RETURNING *
      `;
      
      const result = await pool.query(query, [
        title, full_address, city, state, postal_code, country, is_default, addressId, userId
      ]);
      
      return result.rows[0];
    } catch (error) {
      console.error('Error updating address:', error);
      throw error;
    }
  }

  static async delete(addressId, userId) {
    try {
      const query = 'DELETE FROM addresses WHERE id = $1 AND user_id = $2 RETURNING *';
      const result = await pool.query(query, [addressId, userId]);
      return result.rows[0];
    } catch (error) {
      console.error('Error deleting address:', error);
      throw error;
    }
  }

  static async setDefault(addressId, userId) {
    try {
      // Unset all defaults for this user
      await pool.query('UPDATE addresses SET is_default = false WHERE user_id = $1', [userId]);
      
      // Set the specified address as default
      const query = `
        UPDATE addresses 
        SET is_default = true, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND user_id = $2
        RETURNING *
      `;
      
      const result = await pool.query(query, [addressId, userId]);
      return result.rows[0];
    } catch (error) {
      console.error('Error setting default address:', error);
      throw error;
    }
  }
}

module.exports = Address;

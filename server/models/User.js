const pool = require('../config/database');
const bcrypt = require('bcryptjs');

class User {
  // Create a new user
  static async create(userData) {
    const { name, email, password, google_id } = userData;
    const hashedPassword = password ? await bcrypt.hash(password, 10) : null;
    
    const query = `
      INSERT INTO users (name, email, password, google_id)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, email, google_id
    `;
    
    const result = await pool.query(query, [name, email, hashedPassword, google_id]);
    return result.rows[0];
  }

  // Find user by email
  static async findByEmail(email) {
    const query = 'SELECT * FROM users WHERE email = $1';
    const result = await pool.query(query, [email]);
    return result.rows[0];
  }

  // Find user by ID
  static async findById(id) {
    const query = 'SELECT id, name, email, google_id FROM users WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rows[0];
  }

  // Verify password
  static async verifyPassword(plainPassword, hashedPassword) {
    return await bcrypt.compare(plainPassword, hashedPassword);
  }
}

module.exports = User;


const { Pool } = require('pg');
require('dotenv').config();

let pool;

// Check if DATABASE_URL is provided (for production/deployment)
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
} else {
  // Use individual environment variables (for development)
  pool = new Pool({
    user: process.env.DB_USER || 'restaurant_user',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'restaurant_db',
    password: process.env.DB_PASSWORD || 'secure123',
    port: process.env.DB_PORT || 5432,
  });
}

// Test the connection
pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('❌ Database connection error:', err);
});

// Test connection on startup
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database connection failed:', err.stack);
  } else {
    console.log('✅ Database connected successfully!');
    console.log(`📊 Connected to database: ${client.database}`);
    release();
  }
});

module.exports = pool;

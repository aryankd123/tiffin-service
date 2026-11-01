const { Pool } = require('pg');
const config = require('./config');
const logger = require('./logger');

const pool = new Pool({ connectionString: config.DATABASE_URL, max: 10 });

// Without this listener, an idle client dying (e.g. Postgres restarts) emits an
// unhandled 'error' event and crashes the whole process.
pool.on('error', (err) => {
  logger.error({ err }, 'unexpected error on idle database client');
});

// Runs fn(client) inside BEGIN/COMMIT on one dedicated connection. A transaction must
// stay on one connection, which pool.query() does not guarantee.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, withTransaction };

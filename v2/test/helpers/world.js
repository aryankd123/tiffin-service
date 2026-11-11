// A known starting point for API tests: every table emptied, then a small fixed set of cities,
// users, kitchens, menus, plans and addresses. Each test file calls resetWorld() once.
const { pool, withTransaction } = require('../../src/db');
const { hashPassword } = require('../../src/auth/password');

const PASSWORD = 'correct horse battery';

// Tables the app doesn't own: the migration ledger and PostGIS's reference table.
const KEEP = ['schema_migrations', 'spatial_ref_sys'];

async function truncateAll() {
  const { rows } = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT (tablename = ANY($1))`,
    [KEEP],
  );
  const list = rows.map((r) => `"${r.tablename}"`).join(', ');
  await pool.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

async function resetWorld() {
  await truncateAll();
  const passwordHash = await hashPassword(PASSWORD);

  return withTransaction(async (db) => {
    const one = async (sql, params) => (await db.query(sql, params)).rows[0];

    const city = async (name, state, lat, lng) => (await one(
      `INSERT INTO cities (name, state, centre)
       VALUES ($1, $2, CASE WHEN $3::float8 IS NULL THEN NULL
                            ELSE ST_SetSRID(ST_MakePoint($4::float8, $3::float8), 4326)::geography END)
       RETURNING id`, [name, state, lat, lng])).id;
    const cities = {
      bengaluru: await city('Bengaluru', 'Karnataka', 12.9716, 77.5946),
      delhi: await city('Delhi', 'Delhi', 28.6139, 77.2090),
      noida: await city('Noida', 'Uttar Pradesh', 28.5355, 77.3910),
      unconfigured: await city('Testville', 'Nowhere', null, null), // no centre yet
    };

    const user = async (name, email, role) => (await one(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id`,
      [name, email, passwordHash, role])).id;
    const users = {
      admin: { id: await user('Admin', 'admin@example.com', 'admin'), email: 'admin@example.com' },
      vendor: { id: await user('Vendor', 'vendor@example.com', 'vendor_admin'), email: 'vendor@example.com' },
      customer: { id: await user('Customer', 'customer@example.com', 'customer'), email: 'customer@example.com' },
    };

    const restaurant = async (name, cityId, lat, lng, radius, fee, menu, plans = []) => {
      const r = await one(
        `INSERT INTO restaurants (owner_user_id, city_id, name, location, delivery_radius_m, delivery_fee_paise)
         VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography, $6, $7) RETURNING id`,
        [users.vendor.id, cityId, name, lat, lng, radius, fee]);
      const items = {};
      for (const [itemName, price, available] of menu) {
        items[itemName] = (await one(
          `INSERT INTO menu_items (restaurant_id, name, price_paise, is_available) VALUES ($1, $2, $3, $4) RETURNING id`,
          [r.id, itemName, price, available])).id;
      }
      const planIds = {};
      for (const [planName, slot, meals, price] of plans) {
        planIds[planName] = (await one(
          `INSERT INTO subscription_plans (restaurant_id, name, meal_slot, meals_count, price_paise)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`, [r.id, planName, slot, meals, price])).id;
      }
      return { id: r.id, items, plans: planIds };
    };
    const restaurants = {
      koramangala: await restaurant('Koramangala Kitchen', cities.bengaluru, 12.9352, 77.6245, 6000, 3000,
        [['Veg Thali', 15000, true], ['Masala Dosa', 9000, true], ['Chicken Biryani', 22000, false]],
        [['20 Lunches', 'lunch', 20, 280000], ['20 Dinners', 'dinner', 20, 300000]]),
      indiranagar: await restaurant('Indiranagar Tiffins', cities.bengaluru, 12.9784, 77.6408, 4000, 2500,
        [['Idli Vada', 7000, true]]),
      connaught: await restaurant('Connaught Place Thali', cities.delhi, 28.6315, 77.2167, 5000, 4000,
        [['Rajma Chawal', 13000, true]]),
      noida: await restaurant('Noida Sector 18 Meals', cities.noida, 28.5708, 77.3261, 15000, 5000,
        [['Home Style Thali', 16000, true]]),
    };

    const address = async (label, cityId, lat, lng, isDefault) => (await one(
      `INSERT INTO addresses (user_id, label, contact_name, contact_phone, line1, city_id, postal_code, location, is_default)
       VALUES ($1, $2, 'Customer', '+919876543210', 'MG Road', $3, '560001',
               ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography, $6) RETURNING id`,
      [users.customer.id, label, cityId, lat, lng, isDefault])).id;
    const addresses = {
      home: await address('Home', cities.bengaluru, 12.9716, 77.5946, true),
      parents: await address('Parents (Delhi)', cities.delhi, 28.6139, 77.2090, false),
    };

    return { cities, users, restaurants, addresses };
  });
}

module.exports = { resetWorld, PASSWORD };

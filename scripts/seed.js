// Development seed data. Safe to run any number of times: every insert skips rows that
// already exist. Migrations hold the schema; this script holds data.
// Usage (from the server folder): npm run seed
const config = require('../src/config');
const { pool, withTransaction } = require('../src/db');
const { hashPassword } = require('../src/auth/password');

if (config.NODE_ENV === 'production') {
  console.error('Refusing to seed a production database.');
  process.exit(1);
}
const SEED_PASSWORD = process.env.SEED_PASSWORD;
if (!SEED_PASSWORD || SEED_PASSWORD.length < 12) {
  console.error('SEED_PASSWORD must be set in .env (at least 12 characters).');
  process.exit(1);
}

// Approximate city centres (lat, lng). Noida is included so that a Delhi address can be served
// by a restaurant across the city border.
const CITIES = [
  { name: 'Bengaluru', state: 'Karnataka', lat: 12.9716, lng: 77.5946 },
  { name: 'Delhi', state: 'Delhi', lat: 28.6139, lng: 77.2090 },
  { name: 'Noida', state: 'Uttar Pradesh', lat: 28.5355, lng: 77.3910 },
  { name: 'Guwahati', state: 'Assam', lat: 26.1445, lng: 91.7362 },
];

const USERS = [
  { name: 'Seed Admin', email: 'seed.admin@example.com', role: 'admin' },
  { name: 'Seed Vendor', email: 'seed.vendor@example.com', role: 'vendor_admin' },
  { name: 'Seed Customer', email: 'seed.customer@example.com', role: 'customer' },
];

const RESTAURANTS = [
  {
    name: 'Seed Koramangala Kitchen', city: 'Bengaluru', lat: 12.9352, lng: 77.6245, radius: 6000, fee: 3000,
    menu: [['Veg Thali', 15000, true], ['Masala Dosa', 9000, true], ['Chicken Biryani', 22000, false]],
  },
  {
    name: 'Seed Indiranagar Tiffins', city: 'Bengaluru', lat: 12.9784, lng: 77.6408, radius: 4000, fee: 2500,
    menu: [['Idli Vada', 7000, true], ['Mini Meals', 12000, true]],
  },
  {
    name: 'Seed Connaught Place Thali', city: 'Delhi', lat: 28.6315, lng: 77.2167, radius: 5000, fee: 4000,
    menu: [['Rajma Chawal', 13000, true], ['Chole Bhature', 14000, true]],
  },
  {
    name: 'Seed Noida Sector 18 Meals', city: 'Noida', lat: 28.5708, lng: 77.3261, radius: 15000, fee: 5000,
    menu: [['Home Style Thali', 16000, true], ['Paneer Paratha', 9000, true]],
  },
  {
    name: 'Seed Guwahati Pithas', city: 'Guwahati', lat: 26.1433, lng: 91.7898, radius: 7000, fee: 2000,
    menu: [['Assamese Thali', 18000, false], ['Til Pitha', 6000, true]],
  },
];

const CUSTOMER_ADDRESSES = [
  {
    label: 'Home', city: 'Bengaluru', lat: 12.9716, lng: 77.5946, isDefault: true,
    contactName: 'Seed Customer', line1: 'MG Road', postalCode: '560001',
  },
  {
    label: 'Parents (Delhi)', city: 'Delhi', lat: 28.6139, lng: 77.2090, isDefault: false,
    contactName: 'Seed Parent', line1: 'Janpath', postalCode: '110001',
  },
];

async function main() {
  const passwordHash = await hashPassword(SEED_PASSWORD);

  const counts = await withTransaction(async (db) => {
    const c = { cities: 0, citiesExisting: 0, users: 0, restaurants: 0, feesSet: 0, menuItems: 0, addresses: 0 };

    const cityIds = {};
    for (const city of CITIES) {
      // New city: insert with centre. Existing city without a centre (created before
      // migration 005): fill the centre in. Existing centre: leave it alone.
      const { rows } = await db.query(
        `INSERT INTO cities (name, state, centre)
         VALUES ($1, $2, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography)
         ON CONFLICT (name, state) DO UPDATE
           SET centre = COALESCE(cities.centre, EXCLUDED.centre)
         RETURNING id, (xmax = 0) AS inserted`,
        [city.name, city.state, city.lat, city.lng],
      );
      cityIds[city.name] = rows[0].id;
      if (rows[0].inserted) c.cities++;
      else c.citiesExisting++;
    }

    const userIds = {};
    for (const u of USERS) {
      const ins = await db.query(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ((lower(email))) DO NOTHING
         RETURNING id`,
        [u.name, u.email, passwordHash, u.role],
      );
      c.users += ins.rowCount;
      const { rows } = await db.query('SELECT id FROM users WHERE lower(email) = lower($1)', [u.email]);
      userIds[u.role] = rows[0].id;
    }

    for (const r of RESTAURANTS) {
      const ins = await db.query(
        `INSERT INTO restaurants (owner_user_id, city_id, name, location, delivery_radius_m, delivery_fee_paise)
         SELECT $1, $2, $3, ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography, $6, $7
         WHERE NOT EXISTS (SELECT 1 FROM restaurants WHERE owner_user_id = $1 AND name = $3)`,
        [userIds.vendor_admin, cityIds[r.city], r.name, r.lat, r.lng, r.radius, r.fee],
      );
      c.restaurants += ins.rowCount;
      // Seed restaurants created before migration 006 got fee 0: give them their seed fee once.
      // A fee a vendor has since changed (non-zero) is left alone.
      const fee = await db.query(
        `UPDATE restaurants SET delivery_fee_paise = $3
         WHERE owner_user_id = $1 AND name = $2 AND delivery_fee_paise = 0`,
        [userIds.vendor_admin, r.name, r.fee],
      );
      c.feesSet += fee.rowCount;
      const { rows } = await db.query(
        'SELECT id FROM restaurants WHERE owner_user_id = $1 AND name = $2',
        [userIds.vendor_admin, r.name],
      );
      for (const [name, pricePaise, isVegetarian] of r.menu) {
        const m = await db.query(
          `INSERT INTO menu_items (restaurant_id, name, price_paise, is_vegetarian)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (restaurant_id, name) DO NOTHING`,
          [rows[0].id, name, pricePaise, isVegetarian],
        );
        c.menuItems += m.rowCount;
      }
    }

    for (const a of CUSTOMER_ADDRESSES) {
      const ins = await db.query(
        `INSERT INTO addresses (user_id, label, contact_name, contact_phone, line1, city_id,
                                postal_code, location, is_default)
         SELECT $1, $2, $3, '+919800000000', $4, $5, $6,
                ST_SetSRID(ST_MakePoint($8, $7), 4326)::geography, $9
         WHERE NOT EXISTS (SELECT 1 FROM addresses WHERE user_id = $1 AND label = $2)`,
        [userIds.customer, a.label, a.contactName, a.line1, cityIds[a.city], a.postalCode,
          a.lat, a.lng, a.isDefault],
      );
      c.addresses += ins.rowCount;
    }
    return c;
  });

  console.log('seed complete:', JSON.stringify(counts));
  console.log('seed accounts: seed.admin@example.com, seed.vendor@example.com, seed.customer@example.com');
  console.log('password: the SEED_PASSWORD value in .env');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

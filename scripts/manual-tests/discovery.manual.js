// Restaurant and discovery tests. Needs the server on :3000, migrations 001-005 applied,
// and `npm run seed` done. Run from the server folder:
//   node scripts/manual-tests/discovery.manual.js
const config = require('../../src/config'); // loads .env, so SEED_PASSWORD is available below
const { pool } = require('../../src/db');
const { MAX_DELIVERY_RADIUS_M } = require('../../src/services/restaurantService');
const { call, show, note, registerUser, login } = require('./_http');

const SEED_PASSWORD = process.env.SEED_PASSWORD;

async function project(lat, lng, metres, azimuthDeg) {
  const { rows } = await pool.query(
    `SELECT ST_Y(p::geometry) AS lat, ST_X(p::geometry) AS lng FROM (
       SELECT ST_Project(ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3::float8, radians($4::float8))::geography AS p
     ) s`,
    [lat, lng, metres, azimuthDeg],
  );
  return rows[0];
}

const names = (r) => (r.json.restaurants ?? []).map((x) => `${x.name} (${x.distanceM} m / r ${x.deliveryRadiusM})`).join('; ') || '(none)';

const addr = (over) => ({
  label: 'Test', contactName: 'Tester', contactPhone: '9876543210', line1: 'Somewhere', postalCode: '560001', ...over,
});

(async () => {
  const admin = await login('seed.admin@example.com', SEED_PASSWORD);
  const vendor = await login('seed.vendor@example.com', SEED_PASSWORD);
  const customer = await login('seed.customer@example.com', SEED_PASSWORD);
  const cities = Object.fromEntries((await call('GET', '/cities')).json.cities.map((c) => [c.name, c.id]));
  const custAddrs = (await call('GET', '/addresses', { token: customer.token })).json.addresses;
  const home = custAddrs.find((a) => a.label === 'Home');
  const parents = custAddrs.find((a) => a.label === 'Parents (Delhi)');

  console.log('\n=== R1-R2 roles');
  show('R1', 'customer POST /restaurants', await call('POST', '/restaurants', { token: customer.token, body: { name: 'x', cityId: cities.Bengaluru, location: { lat: 12.97, lng: 77.59 }, deliveryRadiusM: 2000 } }));
  const v2 = await registerUser('vendor.two');
  const promote = await call('PATCH', `/users/${v2.id}/role`, { token: admin.token, body: { role: 'vendor_admin' } });
  show('R2a', 'admin promotes a new user to vendor_admin', promote, `sessionsRevoked=${promote.json.sessionsRevoked}`);
  show('R2b', 'promoted user: old refresh token', await call('POST', '/auth/refresh', { body: { refreshToken: v2.refreshToken } }));
  show('R2c', 'promoted user: old access token → POST /restaurants', await call('POST', '/restaurants', { token: v2.token, body: { name: 'x', cityId: cities.Bengaluru, location: { lat: 12.97, lng: 77.59 }, deliveryRadiusM: 2000 } }));
  const v2b = await login(v2.email, 'correct horse battery');
  note(`after logging in again, role in /me: ${v2b.user.role}`);
  show('R2d', 'admin changes OWN role', await call('PATCH', `/users/${admin.id}/role`, { token: admin.token, body: { role: 'customer' } }));
  show('R2e', 'vendor calls the role endpoint', await call('PATCH', `/users/${v2.id}/role`, { token: vendor.token, body: { role: 'admin' } }));

  console.log('\n=== R3-R4 create a restaurant');
  const centreBlr = { lat: 12.9716, lng: 77.5946 };
  const P = await project(centreBlr.lat, centreBlr.lng, 10000, 0); // 10 km north of Bengaluru centre
  const created = await call('POST', '/restaurants', { token: v2b.token, body: { name: 'Edge Test Kitchen', cityId: cities.Bengaluru, location: P, deliveryRadiusM: 2000 } });
  show('R3a', 'vendor creates restaurant (radius 2000 m)', created);
  const rid = created.json.restaurant.id;
  show('R3b', 'radius 100', await call('POST', '/restaurants', { token: v2b.token, body: { name: 'r100', cityId: cities.Bengaluru, location: P, deliveryRadiusM: 100 } }));
  show('R3c', 'radius 20000', await call('POST', '/restaurants', { token: v2b.token, body: { name: 'r20k', cityId: cities.Bengaluru, location: P, deliveryRadiusM: 20000 } }));
  show('R4', 'city Bengaluru, pin in Delhi', await call('POST', '/restaurants', { token: v2b.token, body: { name: 'far', cityId: cities.Bengaluru, location: { lat: 28.6139, lng: 77.209 }, deliveryRadiusM: 2000 } }));

  console.log('\n=== R5-R7 ownership');
  show('R5a', 'seed vendor PATCHes vendor two\'s restaurant', await call('PATCH', `/restaurants/${rid}`, { token: vendor.token, body: { name: 'hijacked' } }));
  show('R5b', 'admin PATCHes it (name)', await call('PATCH', `/restaurants/${rid}`, { token: admin.token, body: { name: 'Edge Test Kitchen (admin edit)' } }));
  show('R5c', 'PATCH location (not allowed, strict)', await call('PATCH', `/restaurants/${rid}`, { token: v2b.token, body: { location: centreBlr } }));
  const item = await call('POST', `/restaurants/${rid}/menu-items`, { token: v2b.token, body: { name: 'Curd Rice', pricePaise: 8000, isVegetarian: true } });
  show('R6a', 'add menu item', item);
  show('R6b', 'same name again', await call('POST', `/restaurants/${rid}/menu-items`, { token: v2b.token, body: { name: 'Curd Rice', pricePaise: 9000 } }));
  show('R6c', 'price 0', await call('POST', `/restaurants/${rid}/menu-items`, { token: v2b.token, body: { name: 'Free', pricePaise: 0 } }));
  show('R6d', 'price 12.5 (not an integer)', await call('POST', `/restaurants/${rid}/menu-items`, { token: v2b.token, body: { name: 'Half', pricePaise: 12.5 } }));
  const seedRest = (await pool.query("SELECT id FROM restaurants WHERE name = 'Seed Koramangala Kitchen'")).rows[0].id;
  const seedItem = (await pool.query('SELECT id FROM menu_items WHERE restaurant_id = $1 ORDER BY id LIMIT 1', [seedRest])).rows[0].id;
  show('R7a', 'vendor two edits a SEED item via its OWN restaurant URL', await call('PATCH', `/restaurants/${rid}/menu-items/${seedItem}`, { token: v2b.token, body: { pricePaise: 100 } }));
  show('R7b', 'vendor two edits a SEED item via the seed restaurant URL', await call('PATCH', `/restaurants/${seedRest}/menu-items/${seedItem}`, { token: v2b.token, body: { pricePaise: 100 } }));

  console.log('\n=== S1-S2 discovery (seed customer)');
  const s1 = await call('GET', `/restaurants?addressId=${home.id}`, { token: customer.token });
  show('S1', 'Bengaluru "Home"', s1, `\n       → ${names(s1)}`);
  const indira = await pool.query(
    `SELECT round(ST_Distance(r.location, a.location)) AS d, r.delivery_radius_m AS radius
     FROM restaurants r, addresses a WHERE r.name = 'Seed Indiranagar Tiffins' AND a.id = $1`, [home.id]);
  note(`Seed Indiranagar Tiffins is ${indira.rows[0].d} m away with radius ${indira.rows[0].radius} m → inside the 15 km prefilter, rejected by the exact check`);
  const s2 = await call('GET', `/restaurants?addressId=${parents.id}`, { token: customer.token });
  show('S2', 'Delhi "Parents (Delhi)"', s2, `\n       → ${names(s2)}`);

  console.log('\n=== S3 radius boundary (restaurant radius 2000 m)');
  const tester = await registerUser('discovery.tester');
  const in1990 = await project(P.lat, P.lng, 1990, 90);
  const out2010 = await project(P.lat, P.lng, 2010, 90);
  const aIn = (await call('POST', '/addresses', { token: tester.token, body: addr({ label: '1990 m east', cityId: cities.Bengaluru, location: in1990 }) })).json.address;
  const aOut = (await call('POST', '/addresses', { token: tester.token, body: addr({ label: '2010 m east', cityId: cities.Bengaluru, location: out2010 }) })).json.address;
  const s3a = await call('GET', `/restaurants?addressId=${aIn.id}`, { token: tester.token });
  show('S3a', 'address 1990 m from Edge Test Kitchen', s3a, `\n       → ${names(s3a)}`);
  const s3b = await call('GET', `/restaurants?addressId=${aOut.id}`, { token: tester.token });
  show('S3b', 'address 2010 m from Edge Test Kitchen', s3b, `\n       → ${names(s3b)}`);

  console.log('\n=== S4 inactive restaurant');
  await call('PATCH', `/restaurants/${rid}`, { token: v2b.token, body: { isActive: false } });
  const s4 = await call('GET', `/restaurants?addressId=${aIn.id}`, { token: tester.token });
  show('S4a', 'deactivated → discovery from 1990 m', s4, `→ ${names(s4)}`);
  show('S4b', 'GET /restaurants/:id (inactive)', await call('GET', `/restaurants/${rid}`));
  show('S4c', 'GET /restaurants/:id/menu (inactive)', await call('GET', `/restaurants/${rid}/menu`));
  await call('PATCH', `/restaurants/${rid}`, { token: v2b.token, body: { isActive: true } });
  note('reactivated');

  console.log('\n=== S5-S6 access and input checks');
  show('S5', 'tester uses the seed customer\'s addressId', await call('GET', `/restaurants?addressId=${home.id}`, { token: tester.token }));
  show('S6a', 'no addressId', await call('GET', '/restaurants', { token: tester.token }));
  show('S6b', 'no token', await call('GET', `/restaurants?addressId=${aIn.id}`));
  show('S6c', 'limit=0', await call('GET', `/restaurants?addressId=${home.id}&limit=0`, { token: customer.token }));
  show('S6d', 'limit=51', await call('GET', `/restaurants?addressId=${home.id}&limit=51`, { token: customer.token }));
  const lim1 = await call('GET', `/restaurants?addressId=${parents.id}&limit=1`, { token: customer.token });
  show('S6e', 'limit=1 (Delhi address)', lim1, `→ ${names(lim1)}`);

  console.log('\n=== S7 public menu');
  const menu1 = await call('GET', `/restaurants/${rid}/menu`);
  show('S7a', 'menu of Edge Test Kitchen', menu1, `→ ${menu1.json.items.map((i) => i.name).join(', ')}`);
  await call('PATCH', `/restaurants/${rid}/menu-items/${item.json.item.id}`, { token: v2b.token, body: { isAvailable: false } });
  const menu2 = await call('GET', `/restaurants/${rid}/menu`);
  show('S7b', 'after marking Curd Rice unavailable', menu2, `→ ${menu2.json.items.length} items`);
  show('S7c', 'GET /restaurants/999999999', await call('GET', '/restaurants/999999999'));

  console.log('\n=== S8 query plans (enable_seqscan = off, to ask "can the index be used at all?")');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL enable_seqscan = off');
    const plan = async (dwithinDistance) => (await client.query(
      `EXPLAIN SELECT r.id FROM addresses a JOIN restaurants r
         ON r.is_active AND ST_DWithin(r.location, a.location, ${dwithinDistance})
        AND ST_Distance(r.location, a.location) <= r.delivery_radius_m
       WHERE a.id = ${Number(home.id)}`,
    )).rows.map((r) => r['QUERY PLAN']);
    const constant = await plan(MAX_DELIVERY_RADIUS_M);
    const perRow = await plan('r.delivery_radius_m');
    const scanOf = (lines) => lines.filter((l) => /Scan/.test(l) && /restaurants/.test(l)).map((l) => l.trim().replace(/\s+\(cost.*$/, '')).join(' | ');
    console.log(`S8a    constant ${MAX_DELIVERY_RADIUS_M} prefilter → ${scanOf(constant)}`);
    console.log(`S8b    per-row radius in ST_DWithin → ${scanOf(perRow)}`);
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }

  console.log('\n=== S9 prefilter constant matches the CHECK constraint');
  const def = (await pool.query("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'restaurants_delivery_radius_m_check'")).rows[0].d;
  const upper = Number(def.match(/<= (\d+)/)[1]);
  console.log(`S9     CHECK says ${def} → max ${upper}; code MAX_DELIVERY_RADIUS_M = ${MAX_DELIVERY_RADIUS_M} → ${upper === MAX_DELIVERY_RADIUS_M ? 'MATCH' : 'MISMATCH'}`);

  console.log(`\nTest data: vendor ${v2.email}, restaurant ${rid} "Edge Test Kitchen", tester ${tester.email}`);
  await pool.end();
})().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });

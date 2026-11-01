// Address tests. Needs the server running on :3000, migrations 001-005
// applied and `npm run seed` done. Run from the server folder:
//   node scripts/manual-tests/addresses.manual.js
const { Client } = require('pg');
const config = require('../../src/config');
const { pool } = require('../../src/db');
const { call, show, note, registerUser } = require('./_http');

const body = (over = {}) => ({
  label: 'Home',
  contactName: 'Aryan',
  contactPhone: '+91 98765-43210',
  line1: '12 MG Road',
  postalCode: '560001',
  ...over,
});

// A point exactly `metres` north of a city's centre, computed by PostGIS on the spheroid.
async function pointNorthOf(cityId, metres) {
  const { rows } = await pool.query(
    `SELECT ST_Y(p::geometry) AS lat, ST_X(p::geometry) AS lng
     FROM (SELECT ST_Project(centre, $2::float8, 0::float8)::geography AS p FROM cities WHERE id = $1) s`,
    [cityId, metres],
  );
  return rows[0];
}

const countDefaults = async (userId) =>
  (await pool.query('SELECT count(*)::int AS n FROM addresses WHERE user_id = $1 AND is_default', [userId])).rows[0].n;

(async () => {
  console.log('\n=== A0 cities');
  const cities = await call('GET', '/cities');
  show('A0', 'GET /cities (public, configured only)', cities, `→ ${cities.json.cities.map((c) => c.name).join(', ')}`);
  const city = Object.fromEntries(cities.json.cities.map((c) => [c.name, c.id]));
  const unconfigured = (await pool.query("SELECT id FROM cities WHERE centre IS NULL ORDER BY id LIMIT 1")).rows[0];

  const u1 = await registerUser('addr.u1');
  const u2 = await registerUser('addr.u2');

  console.log('\n=== A1-A2 create');
  const a1 = await call('POST', '/addresses', { token: u1.token, body: body({ cityId: city.Bengaluru, location: { lat: 12.9716, lng: 77.5946 } }) });
  show('A1', 'first address (no isDefault sent)', a1, `isDefault=${a1.json.address?.isDefault} phone=${a1.json.address?.contactPhone}`);
  const a2 = await call('POST', '/addresses', {
    token: u1.token,
    body: body({ label: 'Parents', contactName: 'Papa', contactPhone: '098765 43210', line1: 'Janpath', postalCode: '110001', cityId: city.Delhi, location: { lat: 28.6139, lng: 77.2090 } }),
  });
  show('A2', 'second address, Delhi, phone "098765 43210"', a2, `isDefault=${a2.json.address?.isDefault} phone=${a2.json.address?.contactPhone}`);
  const id1 = a1.json.address.id;
  const id2 = a2.json.address.id;

  console.log('\n=== A3-A8 validation and the 50 km rule');
  show('A3', 'swapped Bengaluru pin (lat 77.59, lng 12.97)', await call('POST', '/addresses', { token: u1.token, body: body({ cityId: city.Bengaluru, location: { lat: 77.5946, lng: 12.9716 } }) }));
  show('A4', 'lat sent as a string "12.97"', await call('POST', '/addresses', { token: u1.token, body: body({ cityId: city.Bengaluru, location: { lat: '12.97', lng: 77.59 } }) }));
  show('A5', 'city Delhi, pin in Bengaluru', await call('POST', '/addresses', { token: u1.token, body: body({ cityId: city.Delhi, location: { lat: 12.9716, lng: 77.5946 } }) }));
  const p49 = await pointNorthOf(city.Bengaluru, 49000);
  const p51 = await pointNorthOf(city.Bengaluru, 51000);
  const in49 = await call('POST', '/addresses', { token: u1.token, body: body({ label: 'Edge 49km', cityId: city.Bengaluru, location: p49 }) });
  show('A6a', 'pin 49,000 m north of Bengaluru centre', in49);
  show('A6b', 'pin 51,000 m north of Bengaluru centre', await call('POST', '/addresses', { token: u1.token, body: body({ label: 'Edge 51km', cityId: city.Bengaluru, location: p51 }) }));
  if (unconfigured) {
    show('A7a', `city ${unconfigured.id} has no centre`, await call('POST', '/addresses', { token: u1.token, body: body({ cityId: unconfigured.id, location: { lat: 12.97, lng: 77.59 } }) }));
  }
  show('A7b', 'city 999999 does not exist', await call('POST', '/addresses', { token: u1.token, body: body({ cityId: '999999', location: { lat: 12.97, lng: 77.59 } }) }));
  show('A8a', 'phone "12345"', await call('POST', '/addresses', { token: u1.token, body: body({ contactPhone: '12345', cityId: city.Bengaluru, location: { lat: 12.97, lng: 77.59 } }) }));
  show('A8b', 'PIN code "012345"', await call('POST', '/addresses', { token: u1.token, body: body({ postalCode: '012345', cityId: city.Bengaluru, location: { lat: 12.97, lng: 77.59 } }) }));
  const land = await call('POST', '/addresses', { token: u1.token, body: body({ label: 'Landline test', contactPhone: '080 2222 3333', cityId: city.Bengaluru, location: { lat: 12.97, lng: 77.59 } }) });
  show('A8c', 'Bengaluru landline "080 2222 3333"', land, `phone=${land.json.address?.contactPhone}  ← accepted (known limitation)`);

  console.log('\n=== A9 list');
  const list = await call('GET', '/addresses', { token: u1.token });
  show('A9', 'GET /addresses', list, `→ ${list.json.addresses.map((a) => `${a.label}${a.isDefault ? '*' : ''}`).join(', ')}`);

  console.log('\n=== A10-A11 IDOR and id validation');
  const missing = await call('GET', '/addresses/999999999', { token: u1.token });
  show('A10a', 'u1 GET /addresses/999999999 (does not exist)', missing);
  show('A10b', `u2 GET u1's address ${id1}`, await call('GET', `/addresses/${id1}`, { token: u2.token }));
  show('A10c', `u2 PATCH u1's address`, await call('PATCH', `/addresses/${id1}`, { token: u2.token, body: { label: 'pwned' } }));
  show('A10d', `u2 PATCH u1's address /default`, await call('PATCH', `/addresses/${id1}/default`, { token: u2.token }));
  show('A10e', `u2 DELETE u1's address`, await call('DELETE', `/addresses/${id1}`, { token: u2.token }));
  note(`u1's address label after the attempts: ${(await call('GET', `/addresses/${id1}`, { token: u1.token })).json.address.label}`);
  show('A11a', 'GET /addresses/abc', await call('GET', '/addresses/abc', { token: u1.token }));
  show('A11b', 'GET /addresses/0', await call('GET', '/addresses/0', { token: u1.token }));
  show('A11c', 'GET /addresses/<20 digits>', await call('GET', '/addresses/99999999999999999999', { token: u1.token }));
  show('A11d', 'GET /addresses without a token', await call('GET', '/addresses'));

  console.log('\n=== A12 PATCH');
  show('A12a', 'PATCH label', await call('PATCH', `/addresses/${id1}`, { token: u1.token, body: { label: 'Home (new)' } }));
  show('A12b', 'PATCH { isDefault: true } (unknown key)', await call('PATCH', `/addresses/${id1}`, { token: u1.token, body: { isDefault: true } }));
  show('A12c', 'PATCH {} (empty)', await call('PATCH', `/addresses/${id1}`, { token: u1.token, body: {} }));
  show('A12d', 'PATCH location with lat only', await call('PATCH', `/addresses/${id1}`, { token: u1.token, body: { location: { lat: 12.98 } } }));
  show('A12e', 'PATCH line2 "Flat 4" then null', await call('PATCH', `/addresses/${id1}`, { token: u1.token, body: { line2: 'Flat 4' } }));
  const cleared = await call('PATCH', `/addresses/${id1}`, { token: u1.token, body: { line2: null } });
  note(`after line2: null → line2 = ${JSON.stringify(cleared.json.address?.line2)}`);
  show('A12f', 'PATCH cityId → Delhi (pin still in Bengaluru)', await call('PATCH', `/addresses/${id1}`, { token: u1.token, body: { cityId: city.Delhi } }));

  console.log('\n=== A13 set default');
  show('A13', `PATCH /addresses/${id2}/default`, await call('PATCH', `/addresses/${id2}/default`, { token: u1.token }));
  const l2 = await call('GET', '/addresses', { token: u1.token });
  note(`list now: ${l2.json.addresses.map((a) => `${a.label}${a.isDefault ? '*' : ''}`).join(', ')} · defaults in DB: ${await countDefaults(u1.id)}`);

  console.log('\n=== A14 concurrency');
  const u3 = await registerUser('addr.u3');
  const creates = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => call('POST', '/addresses', {
    token: u3.token, body: body({ label: `Parallel ${i}`, cityId: city.Bengaluru, location: { lat: 12.97 + i / 1000, lng: 77.59 }, isDefault: true }),
  })));
  show('A14a', '6 parallel creates, all with isDefault: true', { status: creates.map((c) => c.status).join(','), json: '' }, `defaults in DB: ${await countDefaults(u3.id)}`);
  const ids3 = creates.map((c) => c.json.address.id);
  const flips = await Promise.all(ids3.map((id) => call('PATCH', `/addresses/${id}/default`, { token: u3.token })));
  show('A14b', '6 parallel set-default on different addresses', { status: flips.map((c) => c.status).join(','), json: '' }, `defaults in DB: ${await countDefaults(u3.id)}`);

  // A14c: the same race WITHOUT the user-row lock, on two raw connections, to show what the lock prevents.
  const nonDefault = (await pool.query(
    'SELECT id FROM addresses WHERE user_id = $1 AND NOT is_default ORDER BY id LIMIT 2', [u3.id],
  )).rows.map((r) => r.id);
  const [x, y] = nonDefault;
  const c1 = new Client({ connectionString: config.DATABASE_URL });
  const c2 = new Client({ connectionString: config.DATABASE_URL });
  await c1.connect();
  await c2.connect();
  await c1.query('BEGIN');
  await c2.query('BEGIN');
  await c1.query('UPDATE addresses SET is_default = false WHERE user_id = $1 AND is_default AND id <> $2', [u3.id, x]);
  const t2Unset = c2.query('UPDATE addresses SET is_default = false WHERE user_id = $1 AND is_default AND id <> $2', [u3.id, y]);
  await new Promise((r) => setTimeout(r, 300)); // T2 is now blocked on the row T1 changed
  await c1.query('UPDATE addresses SET is_default = true WHERE id = $1', [x]);
  await c1.query('COMMIT');
  const unset = await t2Unset;
  let outcome;
  try {
    await c2.query('UPDATE addresses SET is_default = true WHERE id = $1', [y]);
    await c2.query('COMMIT');
    outcome = 'committed (two defaults?!)';
  } catch (e) {
    outcome = `${e.code} on ${e.constraint}`;
    await c2.query('ROLLBACK');
  }
  await c1.end();
  await c2.end();
  show('A14c', 'same race, NO user lock (raw SQL, 2 connections)', { status: 'SQL', json: '' },
    `T2 unset ${unset.rowCount} rows, then: ${outcome} · defaults in DB: ${await countDefaults(u3.id)}`);

  console.log('\n=== A15 delete');
  const edgeId = in49.json.address.id;
  show('A15a', 'DELETE a non-default address', await call('DELETE', `/addresses/${edgeId}`, { token: u1.token }));
  show('A15b', 'DELETE it again', await call('DELETE', `/addresses/${edgeId}`, { token: u1.token }));
  show('A15c', 'DELETE the default address', await call('DELETE', `/addresses/${id2}`, { token: u1.token }));
  note(`defaults left for u1: ${await countDefaults(u1.id)} (no auto-promotion)`);

  console.log('\n=== A16 address used by an order');
  const rest = (await pool.query("SELECT id, city_id FROM restaurants WHERE name = 'Seed Koramangala Kitchen'")).rows[0];
  const ord = await pool.query(
    `INSERT INTO orders (user_id, restaurant_id, city_id, address_id, contact_name, contact_phone,
                         delivery_line, delivery_location, total_paise, idempotency_key)
     SELECT a.user_id, $2, $3, a.id, a.contact_name, a.contact_phone, a.line1, a.location, 15000, 'test-' || a.id
     FROM addresses a WHERE a.id = $1 RETURNING id`,
    [id1, rest.id, rest.city_id],
  );
  note(`created order ${ord.rows[0].id} pointing at address ${id1} (direct SQL)`);
  show('A16', 'DELETE the address the order points at', await call('DELETE', `/addresses/${id1}`, { token: u1.token }));
  const after = (await pool.query('SELECT address_id, delivery_line, contact_phone FROM orders WHERE id = $1', [ord.rows[0].id])).rows[0];
  note(`order after delete: ${JSON.stringify(after)} (snapshot kept)`);

  console.log('\n=== A17 limit of 20');
  const before = (await call('GET', '/addresses', { token: u3.token })).json.addresses.length;
  for (let i = before; i < 20; i++) {
    await call('POST', '/addresses', { token: u3.token, body: body({ label: `Fill ${i}`, cityId: city.Bengaluru, location: { lat: 12.97, lng: 77.59 } }) });
  }
  show('A17', '21st address', await call('POST', '/addresses', { token: u3.token, body: body({ label: 'One too many', cityId: city.Bengaluru, location: { lat: 12.97, lng: 77.59 } }) }));

  console.log('\n=== A19 address used by a subscription');
  const landId = land.json.address.id;
  const plan = (await pool.query(
    `INSERT INTO subscription_plans (restaurant_id, name, price_paise, duration_days)
     VALUES ($1, $2, 300000, 30) RETURNING id, name, price_paise`,
    [rest.id, `Test plan ${Date.now()}`],
  )).rows[0];
  await pool.query(
    `INSERT INTO subscriptions (user_id, plan_id, address_id, plan_name_snapshot, price_paise_snapshot, start_date, end_date)
     VALUES ($1, $2, $3, $4, $5, current_date, current_date + 30)`,
    [u1.id, plan.id, landId, plan.name, plan.price_paise],
  );
  note(`created plan ${plan.id} and a subscription using address ${landId} (direct SQL)`);
  show('A19', 'DELETE an address used by a subscription', await call('DELETE', `/addresses/${landId}`, { token: u1.token }));
  note(`address still readable afterwards: ${(await call('GET', `/addresses/${landId}`, { token: u1.token })).status}`);

  console.log('\n=== A18 database backstop (direct SQL, bypassing the API)');
  try {
    await pool.query(
      `INSERT INTO addresses (user_id, label, contact_name, contact_phone, line1, city_id, postal_code, location)
       VALUES ($1, 'swapped', 'x', '+919876543210', 'x', $2, '560001', ST_SetSRID(ST_MakePoint(12.9716, 77.5946), 4326)::geography)`,
      [u1.id, city.Bengaluru],
    );
    console.log('A18    swapped pin via SQL                                    STORED (unexpected)');
  } catch (e) {
    console.log(`A18    swapped pin via SQL                                    blocked: ${e.constraint ?? e.message}`);
  }

  console.log(`\nTest users: ${u1.email}, ${u2.email}, ${u3.email}`);
  await pool.end();
})().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });

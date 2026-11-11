// Cities and addresses: validation, the India and 50 km rules, ownership, defaults under
// concurrency, deletes and limits (A0-A19).
const { Client } = require('pg');
const config = require('../../src/config');
const { pool } = require('../../src/db');
const { call, registerUser, errorCode } = require('../helpers/api');
const { resetWorld } = require('../helpers/world');

const body = (over = {}) => ({
  label: 'Home', contactName: 'Aryan', contactPhone: '+91 98765-43210', line1: '12 MG Road', postalCode: '560001', ...over,
});

// A point exactly `metres` north of a city's centre, computed by PostGIS on the spheroid.
async function pointNorthOf(cityId, metres) {
  const { rows } = await pool.query(
    `SELECT ST_Y(p::geometry) AS lat, ST_X(p::geometry) AS lng
     FROM (SELECT ST_Project(centre, $2::float8, 0::float8)::geography AS p FROM cities WHERE id = $1) s`,
    [cityId, metres]);
  return rows[0];
}

const countDefaults = async (userId) =>
  (await pool.query('SELECT count(*)::int AS n FROM addresses WHERE user_id = $1 AND is_default', [userId])).rows[0].n;

let world; let city; let u1; let u2; let u3;
const ids = {};

beforeAll(async () => {
  world = await resetWorld();
  city = world.cities;
  u1 = await registerUser('u1');
  u2 = await registerUser('u2');
  u3 = await registerUser('u3');
});

test('A0: GET /cities lists only cities with a centre', async () => {
  const res = await call('GET', '/cities');
  expect(res.status).toBe(200);
  expect(res.body.cities.map((c) => c.name).sort()).toEqual(['Bengaluru', 'Delhi', 'Noida']);
});

describe('create (A1-A2)', () => {
  test('the first address becomes the default; the phone is normalised', async () => {
    const res = await call('POST', '/addresses', { token: u1.token, body: body({ cityId: city.bengaluru, location: { lat: 12.9716, lng: 77.5946 } }) });
    expect(res.status).toBe(201);
    expect(res.body.address).toMatchObject({ isDefault: true, contactPhone: '+919876543210' });
    ids.home = res.body.address.id;
  });

  test('a second address, in another city, is not the default', async () => {
    const res = await call('POST', '/addresses', {
      token: u1.token,
      body: body({ label: 'Parents', contactPhone: '098765 43210', line1: 'Janpath', postalCode: '110001', cityId: city.delhi, location: { lat: 28.6139, lng: 77.2090 } }),
    });
    expect(res.status).toBe(201);
    expect(res.body.address).toMatchObject({ isDefault: false, contactPhone: '+919876543210' });
    ids.parents = res.body.address.id;
  });
});

describe('validation and the 50 km rule (A3-A8)', () => {
  const post = (over) => call('POST', '/addresses', { token: u1.token, body: body(over) });

  test('A3: a pin with latitude and longitude swapped is outside India', async () => {
    const res = await post({ cityId: city.bengaluru, location: { lat: 77.5946, lng: 12.9716 } });
    expect(res.status).toBe(400);
    const messages = res.body.error.details.map((d) => d.message).join(' | ');
    expect(messages).toMatch(/latitude must be inside India/);
    expect(messages).toMatch(/longitude must be inside India/);
  });

  test('A4: a latitude sent as a string is not coerced', async () => {
    expect((await post({ cityId: city.bengaluru, location: { lat: '12.97', lng: 77.59 } })).status).toBe(400);
  });

  test('A5: a pin far from its city is rejected with the distance', async () => {
    const res = await post({ cityId: city.delhi, location: { lat: 12.9716, lng: 77.5946 } });
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('PIN_TOO_FAR_FROM_CITY');
    expect(res.body.error.details.distanceM).toBeGreaterThan(1_700_000);
  });

  test('A6: 49 km from the centre is accepted, 51 km is not', async () => {
    const in49 = await post({ label: 'Edge 49km', cityId: city.bengaluru, location: await pointNorthOf(city.bengaluru, 49000) });
    expect(in49.status).toBe(201);
    ids.edge = in49.body.address.id;
    const out51 = await post({ label: 'Edge 51km', cityId: city.bengaluru, location: await pointNorthOf(city.bengaluru, 51000) });
    expect(out51.status).toBe(422);
    expect(out51.body.error.details.distanceM).toBe(51000);
  });

  test('A7: a city without a centre, and an unknown city', async () => {
    const a = await post({ cityId: city.unconfigured, location: { lat: 12.97, lng: 77.59 } });
    expect([a.status, errorCode(a)]).toEqual([422, 'CITY_NOT_CONFIGURED']);
    const b = await post({ cityId: '999999', location: { lat: 12.97, lng: 77.59 } });
    expect([b.status, errorCode(b)]).toEqual([422, 'UNKNOWN_CITY']);
  });

  test('A8: phone and PIN formats; a landline passes the mobile format (known limitation)', async () => {
    expect((await post({ contactPhone: '12345', cityId: city.bengaluru, location: { lat: 12.97, lng: 77.59 } })).status).toBe(400);
    expect((await post({ postalCode: '012345', cityId: city.bengaluru, location: { lat: 12.97, lng: 77.59 } })).status).toBe(400);
    const land = await post({ label: 'Landline test', contactPhone: '080 2222 3333', cityId: city.bengaluru, location: { lat: 12.97, lng: 77.59 } });
    expect(land.status).toBe(201);
    expect(land.body.address.contactPhone).toBe('+918022223333');
    ids.land = land.body.address.id;
  });
});

test('A9: the list shows the default first, then newest first', async () => {
  const res = await call('GET', '/addresses', { token: u1.token });
  expect(res.body.addresses.map((a) => a.label)).toEqual(['Home', 'Landline test', 'Edge 49km', 'Parents']);
});

describe("someone else's address and bad ids (A10-A11)", () => {
  test('A10: another user gets 404 for every action, and nothing changes', async () => {
    const missing = await call('GET', '/addresses/999999999', { token: u1.token });
    expect([missing.status, errorCode(missing)]).toEqual([404, 'ADDRESS_NOT_FOUND']);
    for (const res of [
      await call('GET', `/addresses/${ids.home}`, { token: u2.token }),
      await call('PATCH', `/addresses/${ids.home}`, { token: u2.token, body: { label: 'pwned' } }),
      await call('PATCH', `/addresses/${ids.home}/default`, { token: u2.token }),
      await call('DELETE', `/addresses/${ids.home}`, { token: u2.token }),
    ]) {
      expect(res.status).toBe(404);
    }
    expect((await call('GET', `/addresses/${ids.home}`, { token: u1.token })).body.address.label).toBe('Home');
  });

  test.each(['abc', '0', '99999999999999999999'])('A11: id "%s" is rejected before any SQL runs', async (id) => {
    expect((await call('GET', `/addresses/${id}`, { token: u1.token })).status).toBe(400);
  });

  test('A11d: no token', async () => {
    expect((await call('GET', '/addresses')).status).toBe(401);
  });
});

describe('PATCH (A12)', () => {
  const patch = (b) => call('PATCH', `/addresses/${ids.home}`, { token: u1.token, body: b });

  test('a known field changes; unknown keys and empty bodies are rejected', async () => {
    expect((await patch({ label: 'Home (new)' })).status).toBe(200);
    expect((await patch({ isDefault: true })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
  });

  test('the pin moves only as a pair', async () => {
    expect((await patch({ location: { lat: 12.98 } })).status).toBe(400);
  });

  test('null clears an optional field', async () => {
    expect((await patch({ line2: 'Flat 4' })).body.address.line2).toBe('Flat 4');
    expect((await patch({ line2: null })).body.address.line2).toBeNull();
  });

  test('changing the city must still satisfy the 50 km rule', async () => {
    const res = await patch({ cityId: city.delhi });
    expect([res.status, errorCode(res)]).toEqual([422, 'PIN_TOO_FAR_FROM_CITY']);
  });
});

test('A13: choosing another default leaves exactly one', async () => {
  const res = await call('PATCH', `/addresses/${ids.parents}/default`, { token: u1.token });
  expect(res.status).toBe(200);
  const list = (await call('GET', '/addresses', { token: u1.token })).body.addresses;
  expect(list[0]).toMatchObject({ label: 'Parents', isDefault: true });
  expect(await countDefaults(u1.id)).toBe(1);
});

describe('concurrency (A14)', () => {
  test('A14a: 6 parallel creates that all ask to be default → one default', async () => {
    const creates = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => call('POST', '/addresses', {
      token: u3.token, body: body({ label: `Parallel ${i}`, cityId: city.bengaluru, location: { lat: 12.97 + i / 1000, lng: 77.59 }, isDefault: true }),
    })));
    expect(creates.map((c) => c.status)).toEqual([201, 201, 201, 201, 201, 201]);
    expect(await countDefaults(u3.id)).toBe(1);
    ids.parallel = creates.map((c) => c.body.address.id);
  });

  test('A14b: 6 parallel set-default calls → one default', async () => {
    const flips = await Promise.all(ids.parallel.map((id) => call('PATCH', `/addresses/${id}/default`, { token: u3.token })));
    expect(flips.map((c) => c.status)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(await countDefaults(u3.id)).toBe(1);
  });

  test('A14c: without the per-user lock the same race fails on the unique index', async () => {
    const [x, y] = (await pool.query(
      'SELECT id FROM addresses WHERE user_id = $1 AND NOT is_default ORDER BY id LIMIT 2', [u3.id])).rows.map((r) => r.id);
    const c1 = new Client({ connectionString: config.DATABASE_URL });
    const c2 = new Client({ connectionString: config.DATABASE_URL });
    await c1.connect();
    await c2.connect();
    try {
      await c1.query('BEGIN');
      await c2.query('BEGIN');
      await c1.query('UPDATE addresses SET is_default = false WHERE user_id = $1 AND is_default AND id <> $2', [u3.id, x]);
      const t2Unset = c2.query('UPDATE addresses SET is_default = false WHERE user_id = $1 AND is_default AND id <> $2', [u3.id, y]);
      await new Promise((r) => setTimeout(r, 300)); // T2 now waits on the row T1 changed
      await c1.query('UPDATE addresses SET is_default = true WHERE id = $1', [x]);
      await c1.query('COMMIT');
      expect((await t2Unset).rowCount).toBe(0); // T2 re-checked the row: no longer the default
      await expect(c2.query('UPDATE addresses SET is_default = true WHERE id = $1', [y]))
        .rejects.toMatchObject({ code: '23505', constraint: 'addresses_one_default_idx' });
      await c2.query('ROLLBACK');
    } finally {
      await c1.end();
      await c2.end();
    }
    expect(await countDefaults(u3.id)).toBe(1);
  });
});

describe('delete (A15-A19)', () => {
  test('A15: delete, delete again, delete the default (no other address is promoted)', async () => {
    expect((await call('DELETE', `/addresses/${ids.edge}`, { token: u1.token })).status).toBe(204);
    expect((await call('DELETE', `/addresses/${ids.edge}`, { token: u1.token })).status).toBe(404);
    expect((await call('DELETE', `/addresses/${ids.parents}`, { token: u1.token })).status).toBe(204);
    expect(await countDefaults(u1.id)).toBe(0);
  });

  test("A16: deleting an order's address keeps the order's own copy of it", async () => {
    const k = world.restaurants.koramangala;
    const order = await call('POST', '/orders', {
      token: u1.token,
      headers: { 'Idempotency-Key': 'address-delete-test-1' },
      body: { restaurantId: k.id, addressId: ids.home, items: [{ menuItemId: k.items['Veg Thali'], quantity: 1 }] },
    });
    expect(order.status).toBe(201);
    expect((await call('DELETE', `/addresses/${ids.home}`, { token: u1.token })).status).toBe(204);
    const { rows } = await pool.query('SELECT address_id, delivery_line, contact_phone FROM orders WHERE id = $1', [order.body.order.id]);
    expect(rows[0]).toEqual({ address_id: null, delivery_line: expect.stringContaining('12 MG Road'), contact_phone: '+919876543210' });
  });

  test('A17: at most 20 addresses per user', async () => {
    const have = (await call('GET', '/addresses', { token: u3.token })).body.addresses.length;
    for (let i = have; i < 20; i++) {
      expect((await call('POST', '/addresses', { token: u3.token, body: body({ label: `Fill ${i}`, cityId: city.bengaluru, location: { lat: 12.97, lng: 77.59 } }) })).status).toBe(201);
    }
    const res = await call('POST', '/addresses', { token: u3.token, body: body({ label: 'One too many', cityId: city.bengaluru, location: { lat: 12.97, lng: 77.59 } }) });
    expect([res.status, errorCode(res)]).toEqual([409, 'ADDRESS_LIMIT_REACHED']);
  });

  test('A18: the database itself refuses a pin outside India', async () => {
    await expect(pool.query(
      `INSERT INTO addresses (user_id, label, contact_name, contact_phone, line1, city_id, postal_code, location)
       VALUES ($1, 'swapped', 'x', '+919876543210', 'x', $2, '560001', ST_SetSRID(ST_MakePoint(12.9716, 77.5946), 4326)::geography)`,
      [u1.id, city.bengaluru],
    )).rejects.toMatchObject({ constraint: 'addresses_location_in_india' });
  });

  test('A19: an address used by a subscription cannot be deleted', async () => {
    const sub = await call('POST', '/subscriptions', {
      token: u1.token,
      body: { planId: world.restaurants.koramangala.plans['20 Lunches'], addressId: ids.land, weekdays: ['mon', 'wed', 'fri'] },
    });
    expect(sub.status).toBe(201);
    const res = await call('DELETE', `/addresses/${ids.land}`, { token: u1.token });
    expect([res.status, errorCode(res)]).toEqual([409, 'ADDRESS_IN_USE']);
    expect((await call('GET', `/addresses/${ids.land}`, { token: u1.token })).status).toBe(200);
  });
});

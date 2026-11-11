// Role changes, restaurants and menus with ownership checks, and discovery: which kitchens
// deliver to an address (R1-R7, S1-S9).
const { pool } = require('../../src/db');
const { MAX_DELIVERY_RADIUS_M } = require('../../src/services/restaurantService');
const { call, login, registerUser, errorCode } = require('../helpers/api');
const { resetWorld, PASSWORD } = require('../helpers/world');

// The point `metres` from (lat, lng) towards `azimuthDeg` (0 = north, 90 = east), on the spheroid.
async function project(lat, lng, metres, azimuthDeg) {
  const { rows } = await pool.query(
    `SELECT ST_Y(p::geometry) AS lat, ST_X(p::geometry) AS lng FROM (
       SELECT ST_Project(ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3::float8, radians($4::float8))::geography AS p
     ) s`, [lat, lng, metres, azimuthDeg]);
  return rows[0];
}

const names = (res) => res.body.restaurants.map((r) => r.name);
const addr = (over) => ({ label: 'Test', contactName: 'Tester', contactPhone: '9876543210', line1: 'Somewhere', postalCode: '560001', ...over });

let world; let admin; let vendor; let customer; let v2; let edge; let edgePin; let item;

beforeAll(async () => {
  world = await resetWorld();
  admin = await login(world.users.admin.email);
  vendor = await login(world.users.vendor.email);
  customer = await login(world.users.customer.email);
});

describe('roles (R1-R2)', () => {
  test('R1: a customer cannot create a restaurant', async () => {
    const res = await call('POST', '/restaurants', { token: customer.token, body: { name: 'x', cityId: world.cities.bengaluru, location: { lat: 12.97, lng: 77.59 }, deliveryRadiusM: 2000 } });
    expect([res.status, errorCode(res)]).toEqual([403, 'FORBIDDEN']);
  });

  test('R2: a role change logs the user out everywhere; old tokens keep the old role', async () => {
    const user = await registerUser('vendor.two');
    const promote = await call('PATCH', `/users/${user.id}/role`, { token: admin.token, body: { role: 'vendor_admin' } });
    expect(promote.status).toBe(200);
    expect(promote.body.sessionsRevoked).toBe(1);
    expect((await call('POST', '/auth/refresh', { body: { refreshToken: user.refreshToken } })).status).toBe(401);
    const stale = await call('POST', '/restaurants', { token: user.token, body: { name: 'x', cityId: world.cities.bengaluru, location: { lat: 12.97, lng: 77.59 }, deliveryRadiusM: 2000 } });
    expect(stale.status).toBe(403);
    v2 = await login(user.email, PASSWORD);
    expect(v2.user.role).toBe('vendor_admin');
  });

  test('R2: an admin cannot change their own role; only admins can change roles', async () => {
    const own = await call('PATCH', `/users/${admin.id}/role`, { token: admin.token, body: { role: 'customer' } });
    expect([own.status, errorCode(own)]).toEqual([409, 'CANNOT_CHANGE_OWN_ROLE']);
    expect((await call('PATCH', `/users/${v2.id}/role`, { token: vendor.token, body: { role: 'admin' } })).status).toBe(403);
  });
});

describe('restaurants and menus (R3-R7)', () => {
  test('R3: a vendor creates a restaurant; the radius must be 500-15000 m', async () => {
    edgePin = await project(12.9716, 77.5946, 10000, 0); // 10 km north of the Bengaluru centre
    const created = await call('POST', '/restaurants', { token: v2.token, body: { name: 'Edge Test Kitchen', cityId: world.cities.bengaluru, location: edgePin, deliveryRadiusM: 2000 } });
    expect(created.status).toBe(201);
    edge = created.body.restaurant.id;
    for (const deliveryRadiusM of [100, 20000]) {
      const res = await call('POST', '/restaurants', { token: v2.token, body: { name: `r${deliveryRadiusM}`, cityId: world.cities.bengaluru, location: edgePin, deliveryRadiusM } });
      expect(res.status).toBe(400);
    }
  });

  test('R4: the pin must be within 50 km of its city', async () => {
    const res = await call('POST', '/restaurants', { token: v2.token, body: { name: 'far', cityId: world.cities.bengaluru, location: { lat: 28.6139, lng: 77.209 }, deliveryRadiusM: 2000 } });
    expect([res.status, errorCode(res)]).toEqual([422, 'PIN_TOO_FAR_FROM_CITY']);
  });

  test('R5: only the owner or an admin may edit; the location is fixed', async () => {
    const other = await call('PATCH', `/restaurants/${edge}`, { token: vendor.token, body: { name: 'hijacked' } });
    expect([other.status, errorCode(other)]).toEqual([403, 'NOT_RESTAURANT_OWNER']);
    expect((await call('PATCH', `/restaurants/${edge}`, { token: admin.token, body: { name: 'Edge Test Kitchen (admin edit)' } })).status).toBe(200);
    expect((await call('PATCH', `/restaurants/${edge}`, { token: v2.token, body: { location: { lat: 12.97, lng: 77.59 } } })).status).toBe(400);
  });

  test('R6: menu items have unique names and whole-paise prices of at least ₹1', async () => {
    const add = (b) => call('POST', `/restaurants/${edge}/menu-items`, { token: v2.token, body: b });
    const created = await add({ name: 'Curd Rice', pricePaise: 8000, isVegetarian: true });
    expect(created.status).toBe(201);
    item = created.body.item.id;
    const dup = await add({ name: 'Curd Rice', pricePaise: 9000 });
    expect([dup.status, errorCode(dup)]).toEqual([409, 'MENU_ITEM_EXISTS']);
    expect((await add({ name: 'Free', pricePaise: 0 })).status).toBe(400);
    expect((await add({ name: 'Half', pricePaise: 12.5 })).status).toBe(400);
  });

  test("R7: another kitchen's item can't be edited through your own restaurant's URL", async () => {
    const k = world.restaurants.koramangala;
    const viaOwn = await call('PATCH', `/restaurants/${edge}/menu-items/${k.items['Veg Thali']}`, { token: v2.token, body: { pricePaise: 100 } });
    expect([viaOwn.status, errorCode(viaOwn)]).toEqual([404, 'MENU_ITEM_NOT_FOUND']);
    const viaTheirs = await call('PATCH', `/restaurants/${k.id}/menu-items/${k.items['Veg Thali']}`, { token: v2.token, body: { pricePaise: 100 } });
    expect([viaTheirs.status, errorCode(viaTheirs)]).toEqual([403, 'NOT_RESTAURANT_OWNER']);
    const { rows } = await pool.query('SELECT price_paise FROM menu_items WHERE id = $1', [k.items['Veg Thali']]);
    expect(rows[0].price_paise).toBe(15000);
  });
});

describe('discovery (S1-S7)', () => {
  const discover = (addressId, token = customer.token, query = '') =>
    call('GET', `/restaurants?addressId=${addressId}${query}`, { token });

  test('S1: Bengaluru home: Koramangala delivers; Indiranagar is close but outside its own 4 km radius', async () => {
    const res = await discover(world.addresses.home);
    expect(res.status).toBe(200);
    expect(names(res)).toEqual(['Koramangala Kitchen']);
    const { rows } = await pool.query(
      `SELECT ST_Distance(r.location, a.location) AS d FROM restaurants r, addresses a
       WHERE r.id = $1 AND a.id = $2`, [world.restaurants.indiranagar.id, world.addresses.home]);
    expect(rows[0].d).toBeGreaterThan(4000);
    expect(rows[0].d).toBeLessThan(MAX_DELIVERY_RADIUS_M); // inside the prefilter, rejected by the exact check
  });

  test('S2: a Delhi address is served across the city border by Noida, nearest first', async () => {
    const res = await discover(world.addresses.parents);
    expect(names(res)).toEqual(['Connaught Place Thali', 'Noida Sector 18 Meals']);
    const [a, b] = res.body.restaurants.map((r) => r.distanceM);
    expect(a).toBeLessThan(b);
  });

  let tester; let near; let far;
  test("S3: the radius boundary: 1990 m is inside a 2000 m radius, 2010 m isn't", async () => {
    tester = await registerUser('discovery.tester');
    const make = async (label, metres) => (await call('POST', '/addresses', {
      token: tester.token, body: addr({ label, cityId: world.cities.bengaluru, location: await project(edgePin.lat, edgePin.lng, metres, 90) }),
    })).body.address.id;
    near = await make('1990 m east', 1990);
    far = await make('2010 m east', 2010);
    const inside = await discover(near, tester.token);
    expect(names(inside)).toEqual(['Edge Test Kitchen (admin edit)']);
    expect(Math.abs(inside.body.restaurants[0].distanceM - 1990)).toBeLessThanOrEqual(1);
    expect(names(await discover(far, tester.token))).toEqual([]);
  });

  test('S4: an inactive restaurant disappears from discovery and its public pages', async () => {
    await call('PATCH', `/restaurants/${edge}`, { token: v2.token, body: { isActive: false } });
    expect(names(await discover(near, tester.token))).toEqual([]);
    expect((await call('GET', `/restaurants/${edge}`)).status).toBe(404);
    expect((await call('GET', `/restaurants/${edge}/menu`)).status).toBe(404);
    await call('PATCH', `/restaurants/${edge}`, { token: v2.token, body: { isActive: true } });
    expect((await call('GET', `/restaurants/${edge}`)).status).toBe(200);
  });

  test("S5: someone else's address can't be used for discovery", async () => {
    const res = await discover(world.addresses.home, tester.token);
    expect([res.status, errorCode(res)]).toEqual([404, 'ADDRESS_NOT_FOUND']);
  });

  test('S6: input checks and the limit', async () => {
    expect((await call('GET', '/restaurants', { token: tester.token })).status).toBe(400);
    expect((await call('GET', `/restaurants?addressId=${near}`)).status).toBe(401);
    expect((await discover(world.addresses.home, customer.token, '&limit=0')).status).toBe(400);
    expect((await discover(world.addresses.home, customer.token, '&limit=51')).status).toBe(400);
    expect(names(await discover(world.addresses.parents, customer.token, '&limit=1'))).toEqual(['Connaught Place Thali']);
  });

  test('S7: the public menu lists available items only', async () => {
    expect((await call('GET', `/restaurants/${edge}/menu`)).body.items.map((i) => i.name)).toEqual(['Curd Rice']);
    await call('PATCH', `/restaurants/${edge}/menu-items/${item}`, { token: v2.token, body: { isAvailable: false } });
    expect((await call('GET', `/restaurants/${edge}/menu`)).body.items).toEqual([]);
    expect((await call('GET', '/restaurants/999999999')).status).toBe(404);
  });
});

describe('the spatial index (S8-S9)', () => {
  // Plan for the discovery join with sequential scans disabled: "can the index be used at all?"
  async function scanOf(dwithinDistance) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      const { rows } = await client.query(
        `EXPLAIN SELECT r.id FROM addresses a JOIN restaurants r
           ON r.is_active AND ST_DWithin(r.location, a.location, ${dwithinDistance})
          AND ST_Distance(r.location, a.location) <= r.delivery_radius_m
         WHERE a.id = ${Number(world.addresses.home)}`);
      await client.query('ROLLBACK');
      return rows.map((r) => r['QUERY PLAN']).filter((l) => /Scan/.test(l) && /restaurants/.test(l)).join('\n');
    } finally {
      client.release();
    }
  }

  test('S8: a constant distance can use the GiST index; a per-row radius cannot', async () => {
    expect(await scanOf(MAX_DELIVERY_RADIUS_M)).toMatch(/Index Scan using restaurants_location_gix on restaurants/);
    expect(await scanOf('r.delivery_radius_m')).toMatch(/Seq Scan on restaurants/);
  });

  test("S9: the code's prefilter distance equals the database's maximum radius", async () => {
    const { rows } = await pool.query(
      "SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'restaurants_delivery_radius_m_check'");
    expect(Number(rows[0].d.match(/<= (\d+)/)[1])).toBe(MAX_DELIVERY_RADIUS_M);
  });
});

// Placing an order: prices from the database, idempotency, serviceability, item and address
// checks, limits, snapshots and database backstops (P1-P18).
const crypto = require('node:crypto');
const { pool } = require('../../src/db');
const { call, login, registerUser, errorCode, placeOrder } = require('../helpers/api');
const { resetWorld } = require('../helpers/world');

let world; let customer; let vendor; let stranger; let k; let cart; let first;

beforeAll(async () => {
  world = await resetWorld();
  customer = await login(world.users.customer.email);
  vendor = await login(world.users.vendor.email);
  stranger = await registerUser('orders.stranger');
  k = world.restaurants.koramangala;
  cart = {
    restaurantId: k.id,
    addressId: world.addresses.home,
    items: [{ menuItemId: k.items['Veg Thali'], quantity: 2 }, { menuItemId: k.items['Masala Dosa'], quantity: 1 }],
  };
});

describe('placing an order (P1-P2)', () => {
  test('P1: totals come from database prices; prices sent by the client are ignored', async () => {
    const res = await placeOrder(customer.token, {
      ...cart, total: 1, totalPaise: 1, items: cart.items.map((i) => ({ ...i, unitPricePaise: 1 })),
    });
    expect(res.status).toBe(201);
    const o = res.body.order;
    expect(o).toMatchObject({ subtotalPaise: 39000, deliveryFeePaise: 3000, totalPaise: 42000, status: 'awaiting_payment' });
    expect(o.items.map((i) => [i.name, i.quantity, i.unitPricePaise, i.lineTotalPaise]).sort())
      .toEqual([['Masala Dosa', 1, 9000, 9000], ['Veg Thali', 2, 15000, 30000]]);
    expect(res.body.payment).toMatchObject({ status: 'created', amountPaise: 42000 });
    first = { id: o.id, body: cart };
  });
});

describe('idempotency (P3-P7)', () => {
  const key = 'idempotency-test-key-1';

  beforeAll(async () => {
    const res = await placeOrder(customer.token, cart, key);
    expect(res.status).toBe(201);
    first.keyed = res.body.order.id;
  });

  test('P3: the same key and body replays the original order', async () => {
    const res = await placeOrder(customer.token, cart, key);
    expect(res.status).toBe(201);
    expect(res.body.order.id).toBe(first.keyed);
    expect(res.headers['idempotent-replayed']).toBe('true');
  });

  test('P4: the same key with a different body is rejected', async () => {
    const res = await placeOrder(customer.token, { ...cart, items: [{ menuItemId: k.items['Veg Thali'], quantity: 3 }] }, key);
    expect([res.status, errorCode(res)]).toEqual([422, 'IDEMPOTENCY_KEY_REUSED']);
  });

  test('P4b: the same items in another order count as the same body', async () => {
    const res = await placeOrder(customer.token, { ...cart, items: [...cart.items].reverse() }, key);
    expect(res.body.order.id).toBe(first.keyed);
  });

  test('P5: the same body with a new key is a new order', async () => {
    const res = await placeOrder(customer.token, cart);
    expect(res.status).toBe(201);
    expect(res.body.order.id).not.toBe(first.keyed);
  });

  test('P6: 5 parallel requests with one key create exactly one order', async () => {
    const raceKey = crypto.randomUUID();
    const racers = await Promise.all([1, 2, 3, 4, 5].map(() => placeOrder(customer.token, cart, raceKey)));
    expect(racers.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(racers.map((r) => r.body.order.id)).size).toBe(1);
    expect(racers.filter((r) => r.headers['idempotent-replayed'] === 'true')).toHaveLength(4);
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM orders WHERE user_id = $1 AND idempotency_key = $2', [customer.id, raceKey]);
    expect(rows[0].n).toBe(1);
  });

  test('P7: the key is required and must look like one', async () => {
    expect((await call('POST', '/orders', { token: customer.token, body: cart })).status).toBe(400);
    expect((await placeOrder(customer.token, cart, 'abc')).status).toBe(400);
  });
});

describe('serviceability (P8-P9)', () => {
  test('P8: a Bengaluru address cannot order from Delhi', async () => {
    const c = world.restaurants.connaught;
    const res = await placeOrder(customer.token, { restaurantId: c.id, addressId: world.addresses.home, items: [{ menuItemId: c.items['Rajma Chawal'], quantity: 1 }] });
    expect([res.status, errorCode(res)]).toEqual([422, 'NOT_SERVICEABLE']);
    expect(res.body.error.details).toMatchObject({ deliveryRadiusM: 5000 });
    expect(res.body.error.details.distanceM).toBeGreaterThan(1_700_000);
  });

  test("P9: the same customer can order to their parents' Delhi address, also across the city border", async () => {
    const c = world.restaurants.connaught;
    const n = world.restaurants.noida;
    const delhi = await placeOrder(customer.token, { restaurantId: c.id, addressId: world.addresses.parents, items: [{ menuItemId: c.items['Rajma Chawal'], quantity: 2 }] });
    expect(delhi.status).toBe(201);
    expect(delhi.body.order.cityId).toBe(world.cities.delhi);
    const noida = await placeOrder(customer.token, { restaurantId: n.id, addressId: world.addresses.parents, items: [{ menuItemId: n.items['Home Style Thali'], quantity: 1 }] });
    expect(noida.status).toBe(201);
    expect(noida.body.order.cityId).toBe(world.cities.noida); // the restaurant's city, not the address's
  });

  test("P9c: a nearby kitchen whose own radius doesn't reach is refused", async () => {
    const i = world.restaurants.indiranagar;
    const res = await placeOrder(customer.token, { restaurantId: i.id, addressId: world.addresses.home, items: [{ menuItemId: i.items['Idli Vada'], quantity: 1 }] });
    expect([res.status, errorCode(res)]).toEqual([422, 'NOT_SERVICEABLE']);
  });
});

describe('items, restaurant and address (P10-P13)', () => {
  test("P10: another kitchen's dish or an unknown item is refused", async () => {
    const rajma = world.restaurants.connaught.items['Rajma Chawal'];
    const mixed = await placeOrder(customer.token, { ...cart, items: [{ menuItemId: k.items['Veg Thali'], quantity: 1 }, { menuItemId: rajma, quantity: 1 }] });
    expect([mixed.status, errorCode(mixed)]).toEqual([422, 'ITEMS_NOT_FOUND']);
    expect(mixed.body.error.details.menuItemIds).toEqual([rajma]);
    const unknown = await placeOrder(customer.token, { ...cart, items: [{ menuItemId: '999999999', quantity: 1 }] });
    expect([unknown.status, errorCode(unknown)]).toEqual([422, 'ITEMS_NOT_FOUND']);
  });

  test('P11: an unavailable item is refused', async () => {
    const res = await placeOrder(customer.token, { ...cart, items: [{ menuItemId: k.items['Chicken Biryani'], quantity: 1 }] });
    expect([res.status, errorCode(res)]).toEqual([422, 'ITEMS_UNAVAILABLE']);
  });

  test('P12: a deactivated restaurant takes no orders', async () => {
    await call('PATCH', `/restaurants/${k.id}`, { token: vendor.token, body: { isActive: false } });
    const res = await placeOrder(customer.token, cart);
    await call('PATCH', `/restaurants/${k.id}`, { token: vendor.token, body: { isActive: true } });
    expect([res.status, errorCode(res)]).toEqual([404, 'RESTAURANT_NOT_FOUND']);
  });

  test("P13: nobody can order to someone else's address", async () => {
    const res = await placeOrder(stranger.token, cart);
    expect([res.status, errorCode(res)]).toEqual([404, 'ADDRESS_NOT_FOUND']);
  });
});

describe('limits (P14-P15)', () => {
  test.each([
    ['the same item twice', [{ quantity: 1 }, { quantity: 1 }]],
    ['quantity 21', [{ quantity: 21 }]],
    ['no items', []],
  ])('P14: %s → 400', async (_label, lines) => {
    const items = lines.map((l) => ({ menuItemId: k.items['Veg Thali'], ...l }));
    expect((await placeOrder(customer.token, { ...cart, items })).status).toBe(400);
  });

  test('P15: an order over ₹50,000 (fee included) is refused', async () => {
    const platter = await call('POST', `/restaurants/${k.id}/menu-items`, { token: vendor.token, body: { name: 'Party Platter', pricePaise: 6000000 } });
    expect(platter.status).toBe(201);
    const res = await placeOrder(customer.token, { ...cart, items: [{ menuItemId: platter.body.item.id, quantity: 1 }] });
    expect([res.status, errorCode(res)]).toEqual([422, 'ORDER_TOO_LARGE']);
    expect(res.body.error.details.totalPaise).toBe(6003000);
  });
});

describe('snapshots, access and backstops (P16-P18)', () => {
  test('P16: later menu and fee changes do not change a placed order', async () => {
    await call('PATCH', `/restaurants/${k.id}/menu-items/${k.items['Veg Thali']}`, { token: vendor.token, body: { pricePaise: 99900, name: 'Veg Thali (renamed)' } });
    await call('PATCH', `/restaurants/${k.id}`, { token: vendor.token, body: { deliveryFeePaise: 9000 } });
    const res = await call('GET', `/orders/${first.id}`, { token: customer.token });
    expect(res.body.order.items.map((i) => [i.name, i.unitPricePaise]).sort()).toEqual([['Masala Dosa', 9000], ['Veg Thali', 15000]]);
    expect(res.body.order).toMatchObject({ deliveryFeePaise: 3000, totalPaise: 42000 });
  });

  test("P17: someone else's order and an unknown order are both 404", async () => {
    expect((await call('GET', `/orders/${first.id}`, { token: stranger.token })).status).toBe(404);
    expect((await call('GET', '/orders/999999999', { token: customer.token })).status).toBe(404);
  });

  test('P18: the database refuses a total that is not subtotal + fee', async () => {
    await expect(pool.query('UPDATE orders SET total_paise = 1 WHERE id = $1', [first.id]))
      .rejects.toMatchObject({ constraint: 'orders_total_is_sum' });
  });
});

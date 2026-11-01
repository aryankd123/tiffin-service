// Order placement tests: placing orders. Needs the server on :3000, migrations
// 001-006 applied and `npm run seed` done. Run from the server folder:
//   node scripts/manual-tests/orders.manual.js
const crypto = require('node:crypto');
require('../../src/config'); // loads .env (SEED_PASSWORD)
const { pool } = require('../../src/db');
const { call, show, note, registerUser, login } = require('./_http');

const SEED_PASSWORD = process.env.SEED_PASSWORD;
const BASE = 'http://localhost:3000/api/v1';

// POST /orders with an Idempotency-Key header (the shared helper doesn't send custom headers).
async function placeOrder(token, key, body) {
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  if (key !== undefined) headers['idempotency-key'] = key;
  const res = await fetch(`${BASE}/orders`, { method: 'POST', headers, body: JSON.stringify(body) });
  const json = await res.json();
  return { status: res.status, json, replayed: res.headers.get('idempotent-replayed') };
}

const summary = (r) => (r.json.order
  ? `order ${r.json.order.id}: subtotal ${r.json.order.subtotalPaise} + fee ${r.json.order.deliveryFeePaise} = ${r.json.order.totalPaise}${r.replayed ? ' [Idempotent-Replayed]' : ''}`
  : '');

(async () => {
  const customer = await login('seed.customer@example.com', SEED_PASSWORD);
  const vendor = await login('seed.vendor@example.com', SEED_PASSWORD);
  const addrs = (await call('GET', '/addresses', { token: customer.token })).json.addresses;
  const home = addrs.find((a) => a.label === 'Home');
  const parents = addrs.find((a) => a.label === 'Parents (Delhi)');
  const rid = async (name) => (await pool.query('SELECT id FROM restaurants WHERE name = $1', [name])).rows[0].id;
  const item = async (restaurantId, name) => (await pool.query(
    'SELECT id, price_paise FROM menu_items WHERE restaurant_id = $1 AND name = $2', [restaurantId, name])).rows[0];
  const kora = await rid('Seed Koramangala Kitchen');
  const cp = await rid('Seed Connaught Place Thali');
  const noida = await rid('Seed Noida Sector 18 Meals');
  const indira = await rid('Seed Indiranagar Tiffins');
  const thali = await item(kora, 'Veg Thali');
  const dosa = await item(kora, 'Masala Dosa');
  const biryani = await item(kora, 'Chicken Biryani');
  const rajma = await item(cp, 'Rajma Chawal');
  const noidaThali = await item(noida, 'Home Style Thali');
  const idli = await item(indira, 'Idli Vada');

  const cart = { restaurantId: kora, addressId: home.id, items: [{ menuItemId: thali.id, quantity: 2 }, { menuItemId: dosa.id, quantity: 1 }] };

  console.log('\n=== P1-P2 place an order; client-sent prices are ignored');
  const key1 = crypto.randomUUID();
  const p1 = await placeOrder(customer.token, key1, { ...cart, total: 1, totalPaise: 1, items: cart.items.map((i) => ({ ...i, unitPricePaise: 1 })) });
  show('P1', 'Home → Koramangala: 2 × Veg Thali + 1 × Masala Dosa', p1, `\n       ${summary(p1)}`);
  note(`expected: 2 × ${thali.price_paise} + 1 × ${dosa.price_paise} = ${2 * thali.price_paise + dosa.price_paise}, + fee 3000`);
  note(`items: ${JSON.stringify(p1.json.order.items.map((i) => [i.name, i.quantity, i.unitPricePaise, i.lineTotalPaise]))}`);
  note(`delivery snapshot: ${JSON.stringify(p1.json.order.delivery)}`);
  const order1 = p1.json.order.id;

  console.log('\n=== P3-P6 idempotency');
  const p3 = await placeOrder(customer.token, key1, cart);
  show('P3', 'same key, same body (a retry)', p3, `→ ${summary(p3)} (same id? ${p3.json.order?.id === order1})`);
  show('P4', 'same key, DIFFERENT body (3 thalis)', await placeOrder(customer.token, key1, { ...cart, items: [{ menuItemId: thali.id, quantity: 3 }] }));
  const reordered = { ...cart, items: [...cart.items].reverse() };
  const p4b = await placeOrder(customer.token, key1, reordered);
  show('P4b', 'same key, same items listed in reverse order', p4b, `→ same id? ${p4b.json.order?.id === order1}`);
  const p5 = await placeOrder(customer.token, crypto.randomUUID(), cart);
  show('P5', 'same body, NEW key', p5, `→ ${summary(p5)} (new order: ${p5.json.order?.id !== order1})`);
  const key6 = crypto.randomUUID();
  const racers = await Promise.all([1, 2, 3, 4, 5].map(() => placeOrder(customer.token, key6, cart)));
  const raceIds = [...new Set(racers.map((r) => r.json.order?.id))];
  const rows6 = (await pool.query('SELECT count(*)::int AS n FROM orders WHERE user_id = $1 AND idempotency_key = $2', [customer.id, key6])).rows[0].n;
  show('P6', '5 parallel requests, same key + body', { status: racers.map((r) => r.status).join(','), json: '' },
    `distinct order ids: ${raceIds.join(',')} · rows in DB: ${rows6} · replayed flags: ${racers.filter((r) => r.replayed).length}`);
  show('P7a', 'no Idempotency-Key header', await placeOrder(customer.token, undefined, cart));
  show('P7b', 'Idempotency-Key "abc" (too short)', await placeOrder(customer.token, 'abc', cart));

  console.log('\n=== P8-P9 serviceability (handoff acceptance tests)');
  show('P8', 'Bengaluru Home → Delhi restaurant', await placeOrder(customer.token, crypto.randomUUID(), { restaurantId: cp, addressId: home.id, items: [{ menuItemId: rajma.id, quantity: 1 }] }));
  const p9a = await placeOrder(customer.token, crypto.randomUUID(), { restaurantId: cp, addressId: parents.id, items: [{ menuItemId: rajma.id, quantity: 2 }] });
  show('P9a', 'same user, Parents (Delhi) → Delhi restaurant', p9a, `→ ${summary(p9a)}, cityId ${p9a.json.order?.cityId}`);
  const p9b = await placeOrder(customer.token, crypto.randomUUID(), { restaurantId: noida, addressId: parents.id, items: [{ menuItemId: noidaThali.id, quantity: 1 }] });
  show('P9b', 'Parents (Delhi) → Noida restaurant (cross-city)', p9b, `→ ${summary(p9b)}, cityId ${p9b.json.order?.cityId} (Noida's city)`);
  show('P9c', 'Home → Indiranagar (5,069 m, radius 4,000)', await placeOrder(customer.token, crypto.randomUUID(), { restaurantId: indira, addressId: home.id, items: [{ menuItemId: idli.id, quantity: 1 }] }));

  console.log('\n=== P10-P13 items, restaurant, address');
  show('P10a', 'Koramangala order with a Delhi dish in the cart', await placeOrder(customer.token, crypto.randomUUID(), { ...cart, items: [{ menuItemId: thali.id, quantity: 1 }, { menuItemId: rajma.id, quantity: 1 }] }));
  show('P10b', 'menu item 999999999', await placeOrder(customer.token, crypto.randomUUID(), { ...cart, items: [{ menuItemId: '999999999', quantity: 1 }] }));
  await call('PATCH', `/restaurants/${kora}/menu-items/${biryani.id}`, { token: vendor.token, body: { isAvailable: false } });
  show('P11', 'Chicken Biryani marked unavailable by the vendor', await placeOrder(customer.token, crypto.randomUUID(), { ...cart, items: [{ menuItemId: biryani.id, quantity: 1 }] }));
  await call('PATCH', `/restaurants/${kora}/menu-items/${biryani.id}`, { token: vendor.token, body: { isAvailable: true } });
  await call('PATCH', `/restaurants/${kora}`, { token: vendor.token, body: { isActive: false } });
  show('P12', 'restaurant deactivated by the vendor', await placeOrder(customer.token, crypto.randomUUID(), cart));
  await call('PATCH', `/restaurants/${kora}`, { token: vendor.token, body: { isActive: true } });
  note('item and restaurant restored');
  const stranger = await registerUser('orders.stranger');
  show('P13', 'another user orders to the seed customer\'s address', await placeOrder(stranger.token, crypto.randomUUID(), cart));

  console.log('\n=== P14-P15 input limits');
  show('P14a', 'same item twice in the list', await placeOrder(customer.token, crypto.randomUUID(), { ...cart, items: [{ menuItemId: thali.id, quantity: 1 }, { menuItemId: thali.id, quantity: 1 }] }));
  show('P14b', 'quantity 21', await placeOrder(customer.token, crypto.randomUUID(), { ...cart, items: [{ menuItemId: thali.id, quantity: 21 }] }));
  show('P14c', 'empty items', await placeOrder(customer.token, crypto.randomUUID(), { ...cart, items: [] }));
  const platter = await call('POST', `/restaurants/${kora}/menu-items`, { token: vendor.token, body: { name: `Party Platter ${Date.now()}`, pricePaise: 6000000 } });
  show('P15', `₹60,000 platter (limit ₹50,000)`, await placeOrder(customer.token, crypto.randomUUID(), { ...cart, items: [{ menuItemId: platter.json.item.id, quantity: 1 }] }));
  await call('PATCH', `/restaurants/${kora}/menu-items/${platter.json.item.id}`, { token: vendor.token, body: { isAvailable: false } });

  console.log('\n=== P16 snapshots: the vendor changes the menu after the order');
  await call('PATCH', `/restaurants/${kora}/menu-items/${thali.id}`, { token: vendor.token, body: { pricePaise: 99900, name: 'Veg Thali (renamed)' } });
  await call('PATCH', `/restaurants/${kora}`, { token: vendor.token, body: { deliveryFeePaise: 9000 } });
  const again = await call('GET', `/orders/${order1}`, { token: customer.token });
  show('P16', `GET /orders/${order1} after price, name and fee changes`, again,
    `\n       items ${JSON.stringify(again.json.order.items.map((i) => [i.name, i.unitPricePaise]))}, fee ${again.json.order.deliveryFeePaise}, total ${again.json.order.totalPaise}`);
  await call('PATCH', `/restaurants/${kora}/menu-items/${thali.id}`, { token: vendor.token, body: { pricePaise: thali.price_paise, name: 'Veg Thali' } });
  await call('PATCH', `/restaurants/${kora}`, { token: vendor.token, body: { deliveryFeePaise: 3000 } });
  note('menu and fee restored');

  console.log('\n=== P17-P18 access and database backstops');
  show('P17a', 'another user GET /orders/:id', await call('GET', `/orders/${order1}`, { token: stranger.token }));
  show('P17b', 'GET /orders/999999999', await call('GET', '/orders/999999999', { token: customer.token }));
  try {
    await pool.query('UPDATE orders SET total_paise = 1 WHERE id = $1', [order1]);
    console.log('P18    total_paise = 1 via SQL                                ACCEPTED (unexpected)');
  } catch (e) {
    console.log(`P18    total_paise = 1 via SQL                                blocked: ${e.constraint}`);
  }

  console.log(`\nTest data: orders placed by seed.customer@example.com; stranger ${stranger.email}; an unavailable "Party Platter" item on Koramangala`);
  await pool.end();
})().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });

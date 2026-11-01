// Order lifecycle tests: order status changes, cancellation, history, lists.
// Needs the server on :3000, migrations 001-007 applied and `npm run seed` done.
// Run from the server folder:  node scripts/manual-tests/lifecycle.manual.js
require('../../src/config'); // loads .env (SEED_PASSWORD)
const { pool } = require('../../src/db');
const { call, show, note, registerUser, login, placeOrder, placePaidOrder } = require('./_http');

const SEED_PASSWORD = process.env.SEED_PASSWORD;
const statusOf = (r) => r.json.order?.status ?? r.json.error?.code;
const timeline = (order) => order.history.map((h) => `${h.from ?? '∅'}→${h.to} (${h.actor}${h.note ? `: "${h.note}"` : ''})`).join(', ');

(async () => {
  const customer = await login('seed.customer@example.com', SEED_PASSWORD);
  const vendor = await login('seed.vendor@example.com', SEED_PASSWORD);
  const admin = await login('seed.admin@example.com', SEED_PASSWORD);
  const home = (await call('GET', '/addresses', { token: customer.token })).json.addresses.find((a) => a.label === 'Home');
  const kora = (await pool.query("SELECT id FROM restaurants WHERE name = 'Seed Koramangala Kitchen'")).rows[0].id;
  const dosa = (await pool.query("SELECT id FROM menu_items WHERE restaurant_id = $1 AND name = 'Masala Dosa'", [kora])).rows[0].id;
  const cart = { restaurantId: kora, addressId: home.id, items: [{ menuItemId: dosa, quantity: 1 }] };
  // An order reaches the restaurant only once paid, so these orders are paid (fake gateway).
  const newOrder = async () => (await placePaidOrder(customer.token, cart)).json.order.id;

  // A second vendor who owns nothing here.
  const other = await registerUser('vendor.other');
  await call('PATCH', `/users/${other.id}/role`, { token: admin.token, body: { role: 'vendor_admin' } });
  const otherVendor = await login(other.email, 'correct horse battery');

  console.log('\n=== T1-T7 status changes');
  const o1 = await newOrder();
  const t1 = await call('GET', `/orders/${o1}`, { token: customer.token });
  show('T1', `new order ${o1}: history`, t1, `→ ${timeline(t1.json.order)}`);
  const t2 = await call('PATCH', `/orders/${o1}/status`, { token: vendor.token, body: { status: 'confirmed' } });
  show('T2', 'vendor: pending → confirmed', t2, `→ ${timeline(t2.json.order)}`);
  const o2 = await newOrder();
  show('T3', 'vendor: pending → delivered (skipping steps)', await call('PATCH', `/orders/${o2}/status`, { token: vendor.token, body: { status: 'delivered' } }));
  show('T4', 'customer tries to confirm their own order', await call('PATCH', `/orders/${o2}/status`, { token: customer.token, body: { status: 'confirmed' } }));
  show('T5a', 'another vendor tries to confirm it', await call('PATCH', `/orders/${o2}/status`, { token: otherVendor.token, body: { status: 'confirmed' } }));
  show('T5b', 'another vendor GETs it', await call('GET', `/orders/${o2}`, { token: otherVendor.token }));
  show('T5c', 'the restaurant\'s vendor GETs it', await call('GET', `/orders/${o2}`, { token: vendor.token }), '(owner view)');
  for (const s of ['preparing', 'out_for_delivery', 'delivered']) {
    await call('PATCH', `/orders/${o1}/status`, { token: vendor.token, body: { status: s } });
  }
  const t6 = await call('GET', `/orders/${o1}`, { token: customer.token });
  show('T6', 'vendor walks o1 to delivered', t6, `\n       → ${timeline(t6.json.order)}`);
  show('T7', 'vendor cancels the delivered order', await call('POST', `/orders/${o1}/cancel`, { token: vendor.token, body: {} }));
  show('T7b', 'PATCH status "cancelled" (not allowed here)', await call('PATCH', `/orders/${o2}/status`, { token: vendor.token, body: { status: 'cancelled' } }));

  console.log('\n=== T8-T12 cancellation rules');
  const t8 = await call('POST', `/orders/${o2}/cancel`, { token: customer.token, body: { reason: 'Ordered by mistake' } });
  show('T8', 'customer cancels a PENDING order, with reason', t8, `→ ${timeline(t8.json.order)}`);
  const o3 = await newOrder();
  await call('PATCH', `/orders/${o3}/status`, { token: vendor.token, body: { status: 'confirmed' } });
  show('T9', 'customer cancels a CONFIRMED order', await call('POST', `/orders/${o3}/cancel`, { token: customer.token }));
  const t10 = await call('POST', `/orders/${o3}/cancel`, { token: vendor.token, body: { reason: 'Out of ingredients' } });
  show('T10', 'vendor cancels the CONFIRMED order', t10, `→ ${timeline(t10.json.order)}`);
  show('T11', 'cancel it again', await call('POST', `/orders/${o3}/cancel`, { token: vendor.token }));
  const o4 = await newOrder();
  const t12 = await call('PATCH', `/orders/${o4}/status`, { token: admin.token, body: { status: 'confirmed' } });
  show('T12', 'admin confirms an order of any restaurant', t12, `→ actor of last step: ${t12.json.order?.history.at(-1).actor}`);

  console.log('\n=== T13 race: customer cancels while the vendor confirms (10 orders)');
  const outcomes = {};
  let historyOk = 0;
  for (let i = 0; i < 10; i++) {
    const id = await newOrder();
    const [c, v] = await Promise.all([
      call('POST', `/orders/${id}/cancel`, { token: customer.token }),
      call('PATCH', `/orders/${id}/status`, { token: vendor.token, body: { status: 'confirmed' } }),
    ]);
    const key = `cancel ${statusOf(c)} / confirm ${statusOf(v)}`;
    outcomes[key] = (outcomes[key] ?? 0) + 1;
    // Exactly one change away from 'pending' (an order also has its payment row).
    const h = (await pool.query(
      "SELECT count(*)::int AS n FROM order_status_history WHERE order_id = $1 AND from_status = 'pending'", [id])).rows[0].n;
    if (h === 1) historyOk++;
  }
  for (const [k, n] of Object.entries(outcomes)) console.log(`T13    ${String(n).padStart(2)} × ${k}`);
  note(`orders changed from 'pending' exactly once: ${historyOk}/10`);

  console.log('\n=== T14 database trigger (direct SQL, bypassing the service)');
  const o5 = await newOrder();
  for (const [from, to] of [['pending', 'delivered'], ['pending', 'preparing']]) {
    try {
      await pool.query('UPDATE orders SET status = $2 WHERE id = $1', [o5, to]);
      console.log(`T14    ${from} → ${to} via SQL                                   ACCEPTED (unexpected)`);
    } catch (e) {
      console.log(`T14    ${from} → ${to} via SQL                                   blocked: ${e.constraint} (${e.message})`);
    }
  }
  await pool.query("UPDATE orders SET status = 'confirmed' WHERE id = $1", [o5]);
  try {
    await pool.query("UPDATE orders SET status = 'pending' WHERE id = $1", [o5]);
    console.log('T14    confirmed → pending via SQL                               ACCEPTED (unexpected)');
  } catch (e) {
    console.log(`T14    confirmed → pending via SQL                               blocked: ${e.constraint}`);
  }

  console.log('\n=== L1-L4 lists and keyset pagination');
  const fresh = await registerUser('orders.pager');
  const fa = (await call('POST', '/addresses', { token: fresh.token, body: { label: 'Home', contactName: 'Pager', contactPhone: '9876543210', line1: 'MG Road', postalCode: '560001', cityId: '1', location: { lat: 12.9716, lng: 77.5946 } } })).json.address;
  const placed = [];
  for (let i = 0; i < 7; i++) placed.push((await placeOrder(fresh.token, { ...cart, addressId: fa.id })).json.order.id);
  const p1 = await call('GET', '/orders?limit=3', { token: fresh.token });
  const p2 = await call('GET', `/orders?limit=3&cursor=${p1.json.nextCursor}`, { token: fresh.token });
  const p3 = await call('GET', `/orders?limit=3&cursor=${p2.json.nextCursor}`, { token: fresh.token });
  const seen = [...p1.json.orders, ...p2.json.orders, ...p3.json.orders].map((o) => o.id);
  show('L1', '7 orders, limit 3: three pages', { status: [p1, p2, p3].map((p) => p.status).join(','), json: '' },
    `\n       pages: [${p1.json.orders.map((o) => o.id)}] [${p2.json.orders.map((o) => o.id)}] [${p3.json.orders.map((o) => o.id)}] · last nextCursor: ${p3.json.nextCursor}`);
  note(`all 7 seen once, newest first: ${JSON.stringify(seen) === JSON.stringify([...placed].reverse())}`);

  // A new order arrives between page 1 and page 2: keyset vs OFFSET.
  const a1 = await call('GET', '/orders?limit=3', { token: fresh.token });
  const newcomer = (await placeOrder(fresh.token, { ...cart, addressId: fa.id })).json.order.id;
  const a2 = await call('GET', `/orders?limit=3&cursor=${a1.json.nextCursor}`, { token: fresh.token });
  const offset2 = (await pool.query('SELECT id FROM orders WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 3 OFFSET 3', [fresh.id])).rows.map((r) => r.id);
  show('L2', `order ${newcomer} placed between page 1 and page 2`, { status: a2.status, json: '' },
    `\n       page 1 [${a1.json.orders.map((o) => o.id)}] · keyset page 2 [${a2.json.orders.map((o) => o.id)}] · OFFSET page 2 would be [${offset2}]`);
  show('L3a', 'cursor "garbage"', await call('GET', '/orders?cursor=garbage', { token: fresh.token }));
  const forged = Buffer.from(JSON.stringify(["1'; DROP TABLE orders; --", '1'])).toString('base64url');
  show('L3b', 'well-formed cursor with SQL in the time field', await call('GET', `/orders?cursor=${forged}`, { token: fresh.token }));
  note(`fresh customer sees only their own orders: ${(await call('GET', '/orders?limit=50', { token: fresh.token })).json.orders.length} (placed 8)`);

  const l4 = await call('GET', `/restaurants/${kora}/orders?status=pending&limit=5`, { token: vendor.token });
  show('L4a', 'vendor: Koramangala pending orders, limit 5', l4, `→ statuses ${[...new Set(l4.json.orders?.map((o) => o.status))]}, nextCursor ${l4.json.nextCursor ? 'yes' : 'no'}`);
  show('L4b', 'another vendor: same list', await call('GET', `/restaurants/${kora}/orders`, { token: otherVendor.token }));
  show('L4c', 'customer: same list', await call('GET', `/restaurants/${kora}/orders`, { token: customer.token }));
  show('L4d', 'status=shipped', await call('GET', `/restaurants/${kora}/orders?status=shipped`, { token: vendor.token }));

  console.log('\n=== L5 query plan for page 2 (enable_seqscan = off)');
  const cur = JSON.parse(Buffer.from(p1.json.nextCursor, 'base64url').toString());
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL enable_seqscan = off');
    const plan = (await client.query(
      `EXPLAIN SELECT o.id FROM orders o
       WHERE o.user_id = $1 AND (o.created_at, o.id) < ($2::timestamptz, $3::bigint)
       ORDER BY o.created_at DESC, o.id DESC LIMIT 4`, [fresh.id, cur[0], cur[1]],
    )).rows.map((r) => r['QUERY PLAN'].trim());
    plan.filter((l) => /Index|Cond|Sort/.test(l)).forEach((l) => console.log(`L5     ${l.replace(/\s+\(cost.*$/, '')}`));
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }

  console.log(`\nTest data: orders by seed.customer and ${fresh.email}; vendor ${other.email}`);
  await pool.end();
})().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });

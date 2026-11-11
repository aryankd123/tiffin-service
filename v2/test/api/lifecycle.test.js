// The order lifecycle: status changes and who may make them, cancellation rules, history,
// races, the transition trigger, and keyset pagination (T1-T14, L1-L5).
const { pool } = require('../../src/db');
const { call, login, registerUser, errorCode, placeOrder, placePaidOrder } = require('../helpers/api');
const { resetWorld } = require('../helpers/world');

const timeline = (order) => order.history.map((h) => `${h.from ?? '∅'}→${h.to} (${h.actor})`);
const setStatus = (token, id, status) => call('PATCH', `/orders/${id}/status`, { token, body: { status } });
const cancel = (token, id, reason) => call('POST', `/orders/${id}/cancel`, { token, body: reason ? { reason } : {} });

let world; let customer; let vendor; let admin; let otherVendor; let cart;
const newOrder = async () => (await placePaidOrder(customer.token, cart)).id;

beforeAll(async () => {
  world = await resetWorld();
  customer = await login(world.users.customer.email);
  vendor = await login(world.users.vendor.email);
  admin = await login(world.users.admin.email);
  const other = await registerUser('vendor.other');
  await call('PATCH', `/users/${other.id}/role`, { token: admin.token, body: { role: 'vendor_admin' } });
  otherVendor = await login(other.email);
  const k = world.restaurants.koramangala;
  cart = { restaurantId: k.id, addressId: world.addresses.home, items: [{ menuItemId: k.items['Masala Dosa'], quantity: 1 }] };
});

describe('status changes (T1-T7)', () => {
  let o1; let o2;

  test('T1: a paid order starts its history at placement, then payment', async () => {
    o1 = await newOrder();
    const res = await call('GET', `/orders/${o1}`, { token: customer.token });
    expect(timeline(res.body.order)).toEqual(['∅→awaiting_payment (customer)', 'awaiting_payment→pending (customer)']);
    expect(res.body.order.history.at(-1).note).toBe('Payment received');
  });

  test('T2: the kitchen confirms', async () => {
    const res = await setStatus(vendor.token, o1, 'confirmed');
    expect(res.status).toBe(200);
    expect(res.body.order.history.at(-1)).toMatchObject({ to: 'confirmed', actor: 'restaurant' });
  });

  test('T3-T5: skipping steps, a customer acting, and another kitchen are all refused', async () => {
    o2 = await newOrder();
    const skip = await setStatus(vendor.token, o2, 'delivered');
    expect([skip.status, errorCode(skip)]).toEqual([409, 'INVALID_TRANSITION']);
    expect(skip.body.error.details.allowed).toEqual(['confirmed']);
    const own = await setStatus(customer.token, o2, 'confirmed');
    expect([own.status, errorCode(own)]).toEqual([403, 'FORBIDDEN']);
    expect((await setStatus(otherVendor.token, o2, 'confirmed')).status).toBe(404);
    expect((await call('GET', `/orders/${o2}`, { token: otherVendor.token })).status).toBe(404);
    expect((await call('GET', `/orders/${o2}`, { token: vendor.token })).status).toBe(200);
  });

  test('T6: the full path to delivered, every step recorded', async () => {
    for (const s of ['preparing', 'out_for_delivery', 'delivered']) expect((await setStatus(vendor.token, o1, s)).status).toBe(200);
    const res = await call('GET', `/orders/${o1}`, { token: customer.token });
    expect(timeline(res.body.order)).toEqual([
      '∅→awaiting_payment (customer)', 'awaiting_payment→pending (customer)', 'pending→confirmed (restaurant)',
      'confirmed→preparing (restaurant)', 'preparing→out_for_delivery (restaurant)', 'out_for_delivery→delivered (restaurant)',
    ]);
  });

  test('T7: a delivered order cannot be cancelled; the status endpoint never cancels', async () => {
    const res = await cancel(vendor.token, o1);
    expect([res.status, errorCode(res)]).toEqual([409, 'CANCEL_NOT_ALLOWED']);
    expect((await setStatus(vendor.token, o2, 'cancelled')).status).toBe(400);
  });

  test('T8: the customer cancels a pending order with a reason', async () => {
    const res = await cancel(customer.token, o2, 'Ordered by mistake');
    expect(res.status).toBe(200);
    expect(res.body.order.history.at(-1)).toMatchObject({ from: 'pending', to: 'cancelled', actor: 'customer', note: 'Ordered by mistake' });
  });
});

describe('cancellation rules (T9-T12)', () => {
  test('T9-T11: once confirmed, only the kitchen (or an admin) may cancel, and only once', async () => {
    const o = await newOrder();
    await setStatus(vendor.token, o, 'confirmed');
    const byCustomer = await cancel(customer.token, o);
    expect([byCustomer.status, errorCode(byCustomer)]).toEqual([409, 'CANCEL_NOT_ALLOWED']);
    expect(byCustomer.body.error.message).toMatch(/contact the restaurant/);
    const byKitchen = await cancel(vendor.token, o, 'Out of ingredients');
    expect(byKitchen.status).toBe(200);
    expect(byKitchen.body.order.history.at(-1)).toMatchObject({ from: 'confirmed', actor: 'restaurant', note: 'Out of ingredients' });
    expect((await cancel(vendor.token, o)).status).toBe(409);
  });

  test("T12: an admin can act on any kitchen's order", async () => {
    const o = await newOrder();
    const res = await setStatus(admin.token, o, 'confirmed');
    expect(res.status).toBe(200);
    expect(res.body.order.history.at(-1).actor).toBe('admin');
  });
});

test('T13: 10 races of "customer cancels" against "kitchen confirms": always exactly one winner', async () => {
  const losers = new Set(['STATUS_CHANGED', 'INVALID_TRANSITION', 'CANCEL_NOT_ALLOWED']);
  for (let i = 0; i < 10; i++) {
    const id = await newOrder();
    const [c, v] = await Promise.all([cancel(customer.token, id), setStatus(vendor.token, id, 'confirmed')]);
    const winners = [c, v].filter((r) => r.status === 200);
    expect(winners).toHaveLength(1);
    const loser = [c, v].find((r) => r.status !== 200);
    expect(loser.status).toBe(409);
    expect(losers.has(errorCode(loser))).toBe(true);
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM order_status_history WHERE order_id = $1 AND from_status = 'pending'", [id]);
    expect(rows[0].n).toBe(1);
  }
});

test('T14: the database refuses illegal status jumps made directly in SQL', async () => {
  const id = await newOrder();
  for (const to of ['delivered', 'preparing']) {
    await expect(pool.query('UPDATE orders SET status = $2 WHERE id = $1', [id, to]))
      .rejects.toMatchObject({ constraint: 'orders_status_transition' });
  }
  await pool.query("UPDATE orders SET status = 'confirmed' WHERE id = $1", [id]);
  await expect(pool.query("UPDATE orders SET status = 'pending' WHERE id = $1", [id]))
    .rejects.toMatchObject({ constraint: 'orders_status_transition' });
});

describe('lists and keyset pagination (L1-L5)', () => {
  let fresh; let placed; let page1;

  beforeAll(async () => {
    fresh = await registerUser('orders.pager');
    const a = await call('POST', '/addresses', { token: fresh.token, body: { label: 'Home', contactName: 'Pager', contactPhone: '9876543210', line1: 'MG Road', postalCode: '560001', cityId: world.cities.bengaluru, location: { lat: 12.9716, lng: 77.5946 } } });
    placed = [];
    for (let i = 0; i < 7; i++) placed.push((await placeOrder(fresh.token, { ...cart, addressId: a.body.address.id })).body.order.id);
    fresh.addressId = a.body.address.id;
  });

  const list = (cursor) => call('GET', `/orders?limit=3${cursor ? `&cursor=${cursor}` : ''}`, { token: fresh.token });

  test('L1: 7 orders in pages of 3, newest first, each seen once', async () => {
    page1 = await list();
    const page2 = await list(page1.body.nextCursor);
    const page3 = await list(page2.body.nextCursor);
    const seen = [page1, page2, page3].flatMap((p) => p.body.orders.map((o) => o.id));
    expect(seen).toEqual([...placed].reverse());
    expect(page3.body.nextCursor).toBeNull();
  });

  test('L2: an order placed between pages does not shift page 2 (unlike OFFSET)', async () => {
    const before = await list();
    await placeOrder(fresh.token, { ...cart, addressId: fresh.addressId });
    const page2 = await list(before.body.nextCursor);
    expect(page2.body.orders.map((o) => o.id)).toEqual([...placed].reverse().slice(3, 6));
    const { rows } = await pool.query(
      'SELECT id FROM orders WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 3 OFFSET 3', [fresh.id]);
    expect(rows.map((r) => r.id)).toContain(before.body.orders[2].id); // OFFSET would repeat an order
  });

  test('L3: tampered cursors are rejected; a customer sees only their own orders', async () => {
    const garbage = await list('garbage');
    expect([garbage.status, errorCode(garbage)]).toEqual([400, 'INVALID_CURSOR']);
    const forged = Buffer.from(JSON.stringify(["1'; DROP TABLE orders; --", '1'])).toString('base64url');
    expect((await list(forged)).status).toBe(400);
    expect((await call('GET', '/orders?limit=50', { token: fresh.token })).body.orders).toHaveLength(8);
  });

  test("L4: the kitchen's inbox: paid orders by status, for the owner only", async () => {
    for (let i = 0; i < 6; i++) await newOrder();
    const k = world.restaurants.koramangala.id;
    const inbox = await call('GET', `/restaurants/${k}/orders?status=pending&limit=5`, { token: vendor.token });
    expect(inbox.status).toBe(200);
    expect(inbox.body.orders).toHaveLength(5);
    expect(new Set(inbox.body.orders.map((o) => o.status))).toEqual(new Set(['pending']));
    expect(inbox.body.nextCursor).toEqual(expect.any(String));
    const other = await call('GET', `/restaurants/${k}/orders`, { token: otherVendor.token });
    expect([other.status, errorCode(other)]).toEqual([403, 'NOT_RESTAURANT_OWNER']);
    const cust = await call('GET', `/restaurants/${k}/orders`, { token: customer.token });
    expect([cust.status, errorCode(cust)]).toEqual([403, 'FORBIDDEN']);
    expect((await call('GET', `/restaurants/${k}/orders?status=shipped`, { token: vendor.token })).status).toBe(400);
  });

  test('L5: page 2 is an index-only scan with the cursor inside the index condition', async () => {
    const [createdAt, id] = JSON.parse(Buffer.from(page1.body.nextCursor, 'base64url').toString());
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      const plan = (await client.query(
        `EXPLAIN SELECT o.id FROM orders o
         WHERE o.user_id = $1 AND (o.created_at, o.id) < ($2::timestamptz, $3::bigint)
         ORDER BY o.created_at DESC, o.id DESC LIMIT 4`, [fresh.id, createdAt, id])).rows.map((r) => r['QUERY PLAN']).join('\n');
      await client.query('ROLLBACK');
      expect(plan).toMatch(/Index Only Scan using orders_user_created_idx/);
      expect(plan).toMatch(/ROW\(created_at, id\) < ROW/);
    } finally {
      client.release();
    }
  });
});

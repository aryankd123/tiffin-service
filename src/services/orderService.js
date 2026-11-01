const crypto = require('node:crypto');
const { pool, withTransaction } = require('../db');
const { AppError } = require('../errors');
const { assertCanManage } = require('./restaurantService');

// ₹50,000 per order. Also keeps every amount far below INTEGER's ₹2.1 crore limit.
const MAX_ORDER_TOTAL_PAISE = 5000000;

// A fingerprint of what the client asked for. Items are sorted by id, so the same cart
// listed in a different order gives the same hash. Ids are compared as numbers-in-strings:
// shorter string = smaller number, equal length = alphabetical.
function requestFingerprint({ restaurantId, addressId, items }) {
  const sorted = items
    .map((i) => [i.menuItemId, i.quantity])
    .sort(([a], [b]) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  const canonical = JSON.stringify({ restaurantId, addressId, items: sorted });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

const ORDER_COLUMNS = `o.id, o.user_id, o.status, o.restaurant_id, r.name AS restaurant_name,
  o.city_id, o.address_id, o.contact_name, o.contact_phone, o.delivery_line,
  ST_Y(o.delivery_location::geometry) AS lat, ST_X(o.delivery_location::geometry) AS lng,
  o.subtotal_paise, o.delivery_fee_paise, o.total_paise, o.created_at`;

function toOrder(row, items, history) {
  return {
    id: row.id,
    status: row.status,
    customerId: row.user_id,
    restaurant: { id: row.restaurant_id, name: row.restaurant_name },
    cityId: row.city_id,
    addressId: row.address_id,
    delivery: {
      contactName: row.contact_name,
      contactPhone: row.contact_phone,
      line: row.delivery_line,
      location: { lat: row.lat, lng: row.lng },
    },
    items: items.map((i) => ({
      menuItemId: i.menu_item_id,
      name: i.item_name,
      quantity: i.quantity,
      unitPricePaise: i.unit_price_paise,
      lineTotalPaise: i.unit_price_paise * i.quantity,
    })),
    subtotalPaise: row.subtotal_paise,
    deliveryFeePaise: row.delivery_fee_paise,
    totalPaise: row.total_paise,
    createdAt: row.created_at,
    history: history.map((h) => ({
      from: h.from_status,
      to: h.to_status,
      actor: h.actor,
      changedByUserId: h.changed_by_user_id,
      note: h.note,
      at: h.changed_at,
    })),
  };
}

async function loadOrder(db, orderId) {
  const { rows } = await db.query(
    `SELECT ${ORDER_COLUMNS} FROM orders o JOIN restaurants r ON r.id = o.restaurant_id
     WHERE o.id = $1`,
    [orderId],
  );
  if (!rows[0]) return null;
  const items = await db.query(
    `SELECT menu_item_id, item_name, quantity, unit_price_paise
     FROM order_items WHERE order_id = $1 ORDER BY menu_item_id`,
    [orderId],
  );
  const history = await db.query(
    `SELECT from_status, to_status, actor, changed_by_user_id, note, changed_at
     FROM order_status_history WHERE order_id = $1 ORDER BY changed_at, id`,
    [orderId],
  );
  return toOrder(rows[0], items.rows, history.rows);
}

async function findByKey(db, userId, idempotencyKey) {
  const { rows } = await db.query(
    'SELECT id, request_hash FROM orders WHERE user_id = $1 AND idempotency_key = $2',
    [userId, idempotencyKey],
  );
  return rows[0] ?? null;
}

// Same key + same request → the original order. Same key + different request → 422.
async function replay(db, existing, requestHash) {
  if (existing.request_hash !== requestHash) {
    throw new AppError(422, 'IDEMPOTENCY_KEY_REUSED',
      'This Idempotency-Key was already used for a different request');
  }
  return { order: await loadOrder(db, existing.id), replayed: true };
}

async function placeOrder(userId, idempotencyKey, input) {
  const requestHash = requestFingerprint(input);

  // Fast path for a retry whose first attempt already committed: no transaction, no locks.
  const previous = await findByKey(pool, userId, idempotencyKey);
  if (previous) return replay(pool, previous, requestHash);

  return withTransaction(async (client) => {
    // 1. The delivery address must be the caller's.
    const addr = await client.query(
      `SELECT a.line1, a.line2, a.postal_code, c.name AS city_name
       FROM addresses a JOIN cities c ON c.id = a.city_id
       WHERE a.id = $1 AND a.user_id = $2`,
      [input.addressId, userId],
    );
    const address = addr.rows[0];
    if (!address) throw new AppError(404, 'ADDRESS_NOT_FOUND', 'Address not found');

    // 2. The restaurant must exist and be active. FOR SHARE: a concurrent deactivation or
    //    fee change waits until this order commits, so the order matches the restaurant's
    //    state at commit time. Other orders also take FOR SHARE, so they don't block each other.
    const rest = await client.query(
      `SELECT r.id, r.city_id, r.delivery_radius_m, r.delivery_fee_paise,
              ST_Distance(r.location, a.location) AS distance_m
       FROM restaurants r, addresses a
       WHERE r.id = $1 AND r.is_active AND a.id = $2
       FOR SHARE OF r`,
      [input.restaurantId, input.addressId],
    );
    const restaurant = rest.rows[0];
    if (!restaurant) throw new AppError(404, 'RESTAURANT_NOT_FOUND', 'Restaurant not found');

    // 3. Serviceability: the address must be inside this restaurant's radius.
    if (restaurant.distance_m > restaurant.delivery_radius_m) {
      throw new AppError(422, 'NOT_SERVICEABLE', 'This restaurant does not deliver to this address', {
        distanceM: Math.round(restaurant.distance_m),
        deliveryRadiusM: restaurant.delivery_radius_m,
      });
    }

    // 4. Every item must belong to THIS restaurant and be available. Prices come from here,
    //    never from the request. FOR SHARE: a concurrent price edit waits for this order.
    const ids = input.items.map((i) => i.menuItemId);
    const menu = await client.query(
      `SELECT id, name, price_paise, is_available FROM menu_items
       WHERE id = ANY($1::bigint[]) AND restaurant_id = $2
       FOR SHARE`,
      [ids, restaurant.id],
    );
    const byId = new Map(menu.rows.map((m) => [m.id, m]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new AppError(422, 'ITEMS_NOT_FOUND', 'Some items are not on this restaurant\'s menu',
        { menuItemIds: missing });
    }
    const unavailable = ids.filter((id) => !byId.get(id).is_available);
    if (unavailable.length > 0) {
      throw new AppError(422, 'ITEMS_UNAVAILABLE', 'Some items are currently unavailable',
        { menuItemIds: unavailable });
    }

    // 5. Money: integer paise; JS numbers are exact far beyond these values.
    const lines = input.items.map((i) => {
      const m = byId.get(i.menuItemId);
      return { id: i.menuItemId, name: m.name, quantity: i.quantity, unitPrice: m.price_paise };
    });
    const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
    const total = subtotal + restaurant.delivery_fee_paise;
    if (total > MAX_ORDER_TOTAL_PAISE) {
      throw new AppError(422, 'ORDER_TOO_LARGE', 'Order total exceeds the maximum allowed',
        { totalPaise: total, maxTotalPaise: MAX_ORDER_TOTAL_PAISE });
    }

    // 6. The order header, with delivery details copied from the address.
    //    ON CONFLICT: if a concurrent request with the same key committed first, this inserts
    //    nothing (after waiting for that transaction) instead of failing.
    const deliveryLine = [address.line1, address.line2, `${address.city_name} ${address.postal_code}`]
      .filter(Boolean)
      .join(', ');
    const inserted = await client.query(
      `INSERT INTO orders (user_id, restaurant_id, city_id, address_id, contact_name, contact_phone,
                           delivery_line, delivery_location, subtotal_paise, delivery_fee_paise,
                           total_paise, idempotency_key, request_hash)
       SELECT $1, $2, $3, a.id, a.contact_name, a.contact_phone,
              $5, a.location, $6, $7, $8, $9, $10
       FROM addresses a WHERE a.id = $4
       ON CONFLICT (user_id, idempotency_key) DO NOTHING
       RETURNING id`,
      [userId, restaurant.id, restaurant.city_id, input.addressId, deliveryLine,
        subtotal, restaurant.delivery_fee_paise, total, idempotencyKey, requestHash],
    );
    if (!inserted.rows[0]) {
      const winner = await findByKey(client, userId, idempotencyKey);
      return replay(client, winner, requestHash);
    }
    const orderId = inserted.rows[0].id;

    // 7. All lines in one statement: unnest turns parallel arrays into rows.
    //    Name and price are snapshots; composite FKs check each item belongs to
    //    this order's restaurant.
    await client.query(
      `INSERT INTO order_items (order_id, restaurant_id, menu_item_id, item_name, quantity, unit_price_paise)
       SELECT $1, $2, x.menu_item_id, x.item_name, x.quantity, x.unit_price_paise
       FROM unnest($3::bigint[], $4::text[], $5::int[], $6::int[])
         AS x(menu_item_id, item_name, quantity, unit_price_paise)`,
      [orderId, restaurant.id, lines.map((l) => l.id), lines.map((l) => l.name),
        lines.map((l) => l.quantity), lines.map((l) => l.unitPrice)],
    );

    // 8. The order's timeline starts here.
    await client.query(
      `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id, actor)
       VALUES ($1, NULL, 'pending', $2, 'customer')`,
      [orderId, userId],
    );

    return { order: await loadOrder(client, orderId), replayed: false };
  });
}

// ---------------------------------------------------------------------------------------------
// Viewing, status changes, cancellation, lists.

// R10: forward moves, made by the restaurant (or an admin).
const FORWARD = {
  pending: ['confirmed'],
  confirmed: ['preparing'],
  preparing: ['out_for_delivery'],
  out_for_delivery: ['delivered'],
};

// From which statuses each actor may cancel.
const CANCELLABLE_FROM = {
  customer: ['pending'],
  restaurant: ['pending', 'confirmed'],
  admin: ['pending', 'confirmed'],
};

// In what capacity the user relates to this order, or null if not at all.
function actorFor(user, access) {
  if (user.role === 'admin') return 'admin';
  if (access.owner_user_id === user.id) return 'restaurant';
  if (access.user_id === user.id) return 'customer';
  return null;
}

async function loadAccess(db, orderId) {
  const { rows } = await db.query(
    `SELECT o.status, o.user_id, r.owner_user_id
     FROM orders o JOIN restaurants r ON r.id = o.restaurant_id
     WHERE o.id = $1`,
    [orderId],
  );
  return rows[0] ?? null;
}

const orderNotFound = () => new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

// Customer, the restaurant's owner, or an admin may view; everyone else gets 404.
async function getOrder(user, orderId) {
  const access = await loadAccess(pool, orderId);
  if (!access || !actorFor(user, access)) throw orderNotFound();
  return loadOrder(pool, orderId);
}

// Optimistic concurrency. The UPDATE succeeds only if the status is still the one we
// decided from. If someone else changed it in between, 0 rows match and we report a conflict
// instead of overwriting their change. The history row is written in the same transaction.
async function compareAndSet(client, orderId, fromStatus, toStatus, user, actor, note) {
  const updated = await client.query(
    'UPDATE orders SET status = $3 WHERE id = $1 AND status = $2',
    [orderId, fromStatus, toStatus],
  );
  if (updated.rowCount === 0) {
    throw new AppError(409, 'STATUS_CHANGED',
      'The order changed while you were updating it; reload and try again');
  }
  await client.query(
    `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id, actor, note)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [orderId, fromStatus, toStatus, user.id, actor, note ?? null],
  );
}

async function advanceStatus(user, orderId, toStatus) {
  return withTransaction(async (client) => {
    const access = await loadAccess(client, orderId);
    const actor = access && actorFor(user, access);
    if (!actor) throw orderNotFound();
    if (actor === 'customer') {
      // They can see the order, so 403 (not 404) is honest here.
      throw new AppError(403, 'FORBIDDEN', 'Only the restaurant can update this order\'s status');
    }
    const allowed = FORWARD[access.status] ?? [];
    if (!allowed.includes(toStatus)) {
      throw new AppError(409, 'INVALID_TRANSITION',
        `Cannot move an order from ${access.status} to ${toStatus}`,
        { from: access.status, to: toStatus, allowed });
    }
    await compareAndSet(client, orderId, access.status, toStatus, user, actor, null);
    return loadOrder(client, orderId);
  });
}

async function cancelOrder(user, orderId, reason) {
  return withTransaction(async (client) => {
    const access = await loadAccess(client, orderId);
    const actor = access && actorFor(user, access);
    if (!actor) throw orderNotFound();
    const allowedFrom = CANCELLABLE_FROM[actor];
    if (!allowedFrom.includes(access.status)) {
      throw new AppError(409, 'CANCEL_NOT_ALLOWED',
        actor === 'customer' && access.status === 'confirmed'
          ? 'The restaurant has already confirmed this order; contact the restaurant to cancel'
          : `An order that is ${access.status} cannot be cancelled`,
        { status: access.status, allowedFrom });
    }
    await compareAndSet(client, orderId, access.status, 'cancelled', user, actor, reason);
    return loadOrder(client, orderId);
  });
}

// Keyset pagination. The cursor is the (created_at, id) of the last row shown, encoded as
// opaque base64url. created_at is carried as Postgres text, which keeps microseconds; a JS Date
// would round to milliseconds and could skip or repeat rows that share a millisecond.
const CURSOR_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;

function encodeCursor(row) {
  return Buffer.from(JSON.stringify([row.created_at_text, row.id])).toString('base64url');
}

function decodeCursor(cursor) {
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (CURSOR_TIME.test(createdAt) && /^[1-9]\d{0,17}$/.test(id)) return { createdAt, id };
  } catch {
    // fall through to the error below
  }
  throw new AppError(400, 'INVALID_CURSOR', 'The pagination cursor is invalid');
}

const SUMMARY_COLUMNS = `o.id, o.status, o.restaurant_id, r.name AS restaurant_name,
  o.contact_name, o.delivery_line, o.total_paise, o.created_at,
  o.created_at::text AS created_at_text,
  (SELECT count(*)::int FROM order_items oi WHERE oi.order_id = o.id) AS item_count`;

function toSummary(row) {
  return {
    id: row.id,
    status: row.status,
    restaurant: { id: row.restaurant_id, name: row.restaurant_name },
    contactName: row.contact_name,
    deliveryLine: row.delivery_line,
    itemCount: row.item_count,
    totalPaise: row.total_paise,
    createdAt: row.created_at,
  };
}

// `filters` are fixed SQL fragments (never request text), each with its own parameter values.
async function listPage(filters, { limit, cursor }) {
  const where = [];
  const values = [];
  for (const [sql, ...params] of filters) {
    const base = values.length;
    values.push(...params);
    where.push(sql.replace(/\$(\d+)/g, (_, n) => `$${base + Number(n)}`));
  }
  if (cursor) {
    const { createdAt, id } = decodeCursor(cursor);
    values.push(createdAt, id);
    where.push(`(o.created_at, o.id) < ($${values.length - 1}::timestamptz, $${values.length}::bigint)`);
  }
  values.push(limit + 1); // one extra row tells us whether another page exists
  const { rows } = await pool.query(
    `SELECT ${SUMMARY_COLUMNS}
     FROM orders o JOIN restaurants r ON r.id = o.restaurant_id
     WHERE ${where.join(' AND ')}
     ORDER BY o.created_at DESC, o.id DESC
     LIMIT $${values.length}`,
    values,
  );
  const page = rows.slice(0, limit);
  return {
    orders: page.map(toSummary),
    nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null,
  };
}

// A customer's own history (index orders_user_created_idx).
async function listCustomerOrders(userId, options) {
  return listPage([['o.user_id = $1', userId]], options);
}

// A restaurant's incoming orders for its owner or an admin (index orders_restaurant_created_idx).
async function listRestaurantOrders(user, restaurantId, { status, ...options }) {
  await assertCanManage(pool, user, restaurantId);
  const filters = [['o.restaurant_id = $1', restaurantId]];
  if (status) filters.push(['o.status = $1', status]);
  return listPage(filters, options);
}

module.exports = {
  placeOrder,
  getOrder,
  advanceStatus,
  cancelOrder,
  listCustomerOrders,
  listRestaurantOrders,
  requestFingerprint,
  MAX_ORDER_TOTAL_PAISE,
};

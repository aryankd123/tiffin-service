const { pool, withTransaction } = require('../db');
const { AppError } = require('../errors');
const { assertPinNearCity } = require('./cityService');
const { findOwned } = require('./addressService');

// The discovery prefilter distance. Must equal the upper bound of
// restaurants_delivery_radius_m_check; a manual test (S10) compares the two.
const MAX_DELIVERY_RADIUS_M = 15000;

const RESTAURANT_COLUMNS = `r.id, r.name, r.city_id, c.name AS city_name,
  ST_Y(r.location::geometry) AS lat, ST_X(r.location::geometry) AS lng,
  r.delivery_radius_m, r.delivery_fee_paise, r.is_active, r.created_at`;

function toRestaurant(row) {
  return {
    id: row.id,
    name: row.name,
    cityId: row.city_id,
    cityName: row.city_name,
    location: { lat: row.lat, lng: row.lng },
    deliveryRadiusM: row.delivery_radius_m,
    deliveryFeePaise: row.delivery_fee_paise,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

function toMenuItem(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    pricePaise: row.price_paise,
    isVegetarian: row.is_vegetarian,
    isAvailable: row.is_available,
  };
}

const MENU_COLUMNS = 'id, name, description, price_paise, is_vegetarian, is_available';

async function fetchRestaurant(db, id, { activeOnly }) {
  const { rows } = await db.query(
    `SELECT ${RESTAURANT_COLUMNS}
     FROM restaurants r JOIN cities c ON c.id = r.city_id
     WHERE r.id = $1 ${activeOnly ? 'AND r.is_active' : ''}`,
    [id],
  );
  if (!rows[0]) throw new AppError(404, 'RESTAURANT_NOT_FOUND', 'Restaurant not found');
  return toRestaurant(rows[0]);
}

// Management rights: the owner or an admin. Restaurants are public, so a non-owner gets
// 403 (not 404): hiding something anyone can GET would protect nothing.
async function checkManage(db, user, restaurantId, { lock }) {
  const { rows } = await db.query(
    `SELECT owner_user_id FROM restaurants WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [restaurantId],
  );
  if (!rows[0]) throw new AppError(404, 'RESTAURANT_NOT_FOUND', 'Restaurant not found');
  if (rows[0].owner_user_id !== user.id && user.role !== 'admin') {
    throw new AppError(403, 'NOT_RESTAURANT_OWNER', 'You do not own this restaurant');
  }
}

// Before changing a restaurant or its menu. FOR UPDATE: concurrent edits take turns.
async function loadForWrite(client, user, restaurantId) {
  return checkManage(client, user, restaurantId, { lock: true });
}

// Before reading the restaurant's private data (its incoming orders): no lock needed.
async function assertCanManage(db, user, restaurantId) {
  return checkManage(db, user, restaurantId, { lock: false });
}

async function createRestaurant(user, input) {
  return withTransaction(async (client) => {
    await assertPinNearCity(client, input.cityId, input.location);
    const { rows } = await client.query(
      `INSERT INTO restaurants (owner_user_id, city_id, name, location, delivery_radius_m, delivery_fee_paise)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography, $6, $7)
       RETURNING id`,
      [user.id, input.cityId, input.name, input.location.lat, input.location.lng,
        input.deliveryRadiusM, input.deliveryFeePaise],
    );
    return fetchRestaurant(client, rows[0].id, { activeOnly: false });
  });
}

async function getPublicRestaurant(id) {
  return fetchRestaurant(pool, id, { activeOnly: true });
}

// Location and city are fixed after creation: moving a restaurant would silently change
// which addresses it serves; a vendor who moves opens a new restaurant instead.
const RESTAURANT_UPDATABLE = {
  name: 'name',
  deliveryRadiusM: 'delivery_radius_m',
  // A fee change applies to future orders only: each order stores its own fee.
  deliveryFeePaise: 'delivery_fee_paise',
  isActive: 'is_active',
};

const MENU_UPDATABLE = {
  name: 'name',
  description: 'description',
  pricePaise: 'price_paise',
  isVegetarian: 'is_vegetarian',
  isAvailable: 'is_available',
};

// Builds "col = $n, ..." from a whitelist. Values start after the fixed parameters.
function buildSet(patch, whitelist, values) {
  const sets = [];
  for (const [field, column] of Object.entries(whitelist)) {
    if (patch[field] !== undefined) {
      values.push(patch[field]);
      sets.push(`${column} = $${values.length}`);
    }
  }
  return sets.join(', ');
}

async function updateRestaurant(user, restaurantId, patch) {
  return withTransaction(async (client) => {
    await loadForWrite(client, user, restaurantId);
    const values = [restaurantId];
    const set = buildSet(patch, RESTAURANT_UPDATABLE, values);
    await client.query(`UPDATE restaurants SET ${set} WHERE id = $1`, values);
    return fetchRestaurant(client, restaurantId, { activeOnly: false });
  });
}

// Public menu: only available items of an active restaurant.
async function listMenu(restaurantId) {
  await fetchRestaurant(pool, restaurantId, { activeOnly: true });
  const { rows } = await pool.query(
    `SELECT ${MENU_COLUMNS} FROM menu_items
     WHERE restaurant_id = $1 AND is_available
     ORDER BY name`,
    [restaurantId],
  );
  return rows.map(toMenuItem);
}

function mapMenuConflict(err) {
  if (err.code === '23505' && err.constraint === 'menu_items_restaurant_id_name_key') {
    return new AppError(409, 'MENU_ITEM_EXISTS', 'This restaurant already has an item with this name');
  }
  return err;
}

async function addMenuItem(user, restaurantId, input) {
  try {
    return await withTransaction(async (client) => {
      await loadForWrite(client, user, restaurantId);
      const { rows } = await client.query(
        `INSERT INTO menu_items (restaurant_id, name, description, price_paise, is_vegetarian, is_available)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${MENU_COLUMNS}`,
        [restaurantId, input.name, input.description ?? null, input.pricePaise,
          input.isVegetarian, input.isAvailable],
      );
      return toMenuItem(rows[0]);
    });
  } catch (err) {
    throw mapMenuConflict(err);
  }
}

// The item is looked up by (id, restaurant_id), so the restaurant in the URL must be the
// item's real restaurant. Passing the ownership check for restaurant A doesn't unlock B's items.
// A price change never touches past orders: they hold unit_price_paise snapshots.
async function updateMenuItem(user, restaurantId, itemId, patch) {
  try {
    return await withTransaction(async (client) => {
      await loadForWrite(client, user, restaurantId);
      const values = [itemId, restaurantId];
      const set = buildSet(patch, MENU_UPDATABLE, values);
      const { rows } = await client.query(
        `UPDATE menu_items SET ${set} WHERE id = $1 AND restaurant_id = $2 RETURNING ${MENU_COLUMNS}`,
        values,
      );
      if (!rows[0]) throw new AppError(404, 'MENU_ITEM_NOT_FOUND', 'Menu item not found');
      return toMenuItem(rows[0]);
    });
  } catch (err) {
    throw mapMenuConflict(err);
  }
}

// Discovery: restaurants that deliver to one of the caller's saved addresses.
// 1. ST_DWithin with a constant distance lets the GiST index pick the few candidates.
// 2. The exact per-restaurant radius check runs only on those candidates.
// No city filter: a Noida restaurant may serve a Delhi address.
async function discover(userId, addressId, limit) {
  const address = await findOwned(pool, userId, addressId); // 404 if not the caller's
  const { rows } = await pool.query(
    `SELECT r.id, r.name, r.city_id, c.name AS city_name, r.delivery_radius_m,
            r.delivery_fee_paise, ST_Distance(r.location, a.location) AS distance_m
     FROM addresses a
     JOIN restaurants r
       ON r.is_active
      AND ST_DWithin(r.location, a.location, $2)
      AND ST_Distance(r.location, a.location) <= r.delivery_radius_m
     JOIN cities c ON c.id = r.city_id
     WHERE a.id = $1
     ORDER BY distance_m, r.id
     LIMIT $3`,
    [addressId, MAX_DELIVERY_RADIUS_M, limit],
  );
  return {
    address: { id: address.id, label: address.label, cityName: address.cityName },
    restaurants: rows.map((r) => ({
      id: r.id,
      name: r.name,
      cityId: r.city_id,
      cityName: r.city_name,
      distanceM: Math.round(r.distance_m),
      deliveryRadiusM: r.delivery_radius_m,
      deliveryFeePaise: r.delivery_fee_paise,
    })),
  };
}

module.exports = {
  createRestaurant,
  getPublicRestaurant,
  updateRestaurant,
  listMenu,
  addMenuItem,
  updateMenuItem,
  discover,
  assertCanManage,
  MAX_DELIVERY_RADIUS_M,
};

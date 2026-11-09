const { pool, withTransaction } = require('../db');
const { AppError } = require('../errors');
const { assertPinNearCity } = require('./cityService');

const MAX_ADDRESSES_PER_USER = 20;

const ADDRESS_COLUMNS = `a.id, a.label, a.contact_name, a.contact_phone, a.line1, a.line2,
  a.city_id, c.name AS city_name, a.postal_code,
  ST_Y(a.location::geometry) AS lat, ST_X(a.location::geometry) AS lng,
  a.is_default, a.created_at`;

// DB rows are snake_case; the API speaks camelCase.
function toAddress(row) {
  return {
    id: row.id,
    label: row.label,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    line1: row.line1,
    line2: row.line2,
    cityId: row.city_id,
    cityName: row.city_name,
    postalCode: row.postal_code,
    location: { lat: row.lat, lng: row.lng },
    isDefault: row.is_default,
    createdAt: row.created_at,
  };
}

// Every lookup includes user_id: another user's address is indistinguishable from
// one that doesn't exist, so ids can't be probed (IDOR protection).
async function findOwned(db, userId, addressId) {
  const { rows } = await db.query(
    `SELECT ${ADDRESS_COLUMNS}
     FROM addresses a JOIN cities c ON c.id = a.city_id
     WHERE a.id = $1 AND a.user_id = $2`,
    [addressId, userId],
  );
  if (!rows[0]) throw new AppError(404, 'ADDRESS_NOT_FOUND', 'Address not found');
  return toAddress(rows[0]);
}

// Serialises all default-changing operations of one user: concurrent requests for the
// same user queue on this row lock; other users are unaffected.
async function lockUser(client, userId) {
  const { rows } = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
  if (!rows[0]) throw new AppError(401, 'NOT_AUTHENTICATED', 'User no longer exists');
}

async function listAddresses(userId) {
  const { rows } = await pool.query(
    `SELECT ${ADDRESS_COLUMNS}
     FROM addresses a JOIN cities c ON c.id = a.city_id
     WHERE a.user_id = $1
     ORDER BY a.is_default DESC, a.created_at DESC, a.id DESC`,
    [userId],
  );
  return rows.map(toAddress);
}

async function getAddress(userId, addressId) {
  return findOwned(pool, userId, addressId);
}

async function createAddress(userId, input) {
  return withTransaction(async (client) => {
    await lockUser(client, userId);

    const { rows } = await client.query(
      'SELECT count(*)::int AS n FROM addresses WHERE user_id = $1',
      [userId],
    );
    const existing = rows[0].n;
    if (existing >= MAX_ADDRESSES_PER_USER) {
      throw new AppError(409, 'ADDRESS_LIMIT_REACHED',
        `You can save at most ${MAX_ADDRESSES_PER_USER} addresses`);
    }

    await assertPinNearCity(client, input.cityId, input.location);

    // The first address becomes the default automatically.
    const makeDefault = existing === 0 || input.isDefault === true;
    if (makeDefault) {
      // Unset first: the partial unique index allows only one default per user and is
      // checked row by row, so the old default must be cleared before the new one is written.
      await client.query(
        'UPDATE addresses SET is_default = false WHERE user_id = $1 AND is_default',
        [userId],
      );
    }

    const inserted = await client.query(
      `INSERT INTO addresses
         (user_id, label, contact_name, contact_phone, line1, line2, city_id, postal_code,
          location, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
               ST_SetSRID(ST_MakePoint($10, $9), 4326)::geography, $11)
       RETURNING id`,
      [
        userId, input.label, input.contactName, input.contactPhone, input.line1,
        input.line2 ?? null, input.cityId, input.postalCode,
        input.location.lat, input.location.lng, makeDefault,
      ],
    );
    return findOwned(client, userId, inserted.rows[0].id);
  });
}

// API field → column. Only these names can ever reach the SET clause (identifiers
// can't be bind parameters, so they come from this fixed whitelist, never from the request).
const UPDATABLE = {
  label: 'label',
  contactName: 'contact_name',
  contactPhone: 'contact_phone',
  line1: 'line1',
  line2: 'line2',
  cityId: 'city_id',
  postalCode: 'postal_code',
};

async function updateAddress(userId, addressId, patch) {
  return withTransaction(async (client) => {
    const current = await findOwned(client, userId, addressId);

    // Moving the pin or changing the city: the final pair must still satisfy the 50 km rule.
    if (patch.location || patch.cityId) {
      await assertPinNearCity(
        client,
        patch.cityId ?? current.cityId,
        patch.location ?? current.location,
      );
    }

    const sets = [];
    const values = [addressId, userId];
    for (const [field, column] of Object.entries(UPDATABLE)) {
      if (patch[field] !== undefined) {
        values.push(patch[field]);
        sets.push(`${column} = $${values.length}`);
      }
    }
    if (patch.location) {
      values.push(patch.location.lat, patch.location.lng);
      sets.push(`location = ST_SetSRID(ST_MakePoint($${values.length}, $${values.length - 1}), 4326)::geography`);
    }

    await client.query(
      `UPDATE addresses SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2`,
      values,
    );
    // Past orders are unaffected: they hold their own snapshot of the address.
    return findOwned(client, userId, addressId);
  });
}

async function setDefaultAddress(userId, addressId) {
  return withTransaction(async (client) => {
    await lockUser(client, userId);
    await findOwned(client, userId, addressId);
    // Two statements, in this order, for the same reason as in createAddress.
    await client.query(
      'UPDATE addresses SET is_default = false WHERE user_id = $1 AND is_default AND id <> $2',
      [userId, addressId],
    );
    await client.query(
      'UPDATE addresses SET is_default = true WHERE id = $1 AND user_id = $2',
      [addressId, userId],
    );
    return findOwned(client, userId, addressId);
  });
}

// Hard delete. Orders keep their snapshot and get address_id = NULL;
// an address still used by a subscription can't be deleted.
// Deleting the default does not promote another address.
async function deleteAddress(userId, addressId) {
  let result;
  try {
    result = await pool.query(
      'DELETE FROM addresses WHERE id = $1 AND user_id = $2 RETURNING id',
      [addressId, userId],
    );
  } catch (err) {
    if (err.code === '23503') {
      throw new AppError(409, 'ADDRESS_IN_USE', 'This address is used by a subscription');
    }
    throw err;
  }
  if (result.rowCount === 0) throw new AppError(404, 'ADDRESS_NOT_FOUND', 'Address not found');
}

module.exports = {
  listAddresses,
  getAddress,
  createAddress,
  updateAddress,
  setDefaultAddress,
  deleteAddress,
  findOwned,
  MAX_ADDRESSES_PER_USER,
};

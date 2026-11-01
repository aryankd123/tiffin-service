const { pool } = require('../db');
const { AppError } = require('../errors');

// A pin must lie within this distance of the centre of the city it claims.
const MAX_PIN_DISTANCE_FROM_CITY_M = 50000;

function toCity(row) {
  return {
    id: row.id,
    name: row.name,
    state: row.state,
    centre: row.lat === null ? null : { lat: row.lat, lng: row.lng },
  };
}

const CITY_COLUMNS = `id, name, state,
  ST_Y(centre::geometry) AS lat, ST_X(centre::geometry) AS lng`;

// Public list for the address form: only cities that can take addresses (have a centre).
async function listConfiguredCities() {
  const { rows } = await pool.query(
    `SELECT ${CITY_COLUMNS} FROM cities WHERE centre IS NOT NULL ORDER BY name, state`,
  );
  return rows.map(toCity);
}

async function createCity({ name, state, centre }) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO cities (name, state, centre)
       VALUES ($1, $2, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography)
       RETURNING ${CITY_COLUMNS}`,
      [name, state, centre.lat, centre.lng],
    );
    return toCity(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      throw new AppError(409, 'CITY_EXISTS', 'This city already exists');
    }
    throw err;
  }
}

// Throws unless the city exists, has a centre, and the pin is within 50 km of it.
// `db` is the pool or a transaction client, so the check can run inside the caller's transaction.
async function assertPinNearCity(db, cityId, { lat, lng }) {
  const { rows } = await db.query(
    `SELECT centre IS NOT NULL AS configured,
            ST_Distance(centre, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography) AS distance_m
     FROM cities WHERE id = $1`,
    [cityId, lat, lng],
  );
  const city = rows[0];
  if (!city) {
    throw new AppError(422, 'UNKNOWN_CITY', 'This city does not exist');
  }
  if (!city.configured) {
    throw new AppError(422, 'CITY_NOT_CONFIGURED', 'This city is not accepting addresses yet');
  }
  if (city.distance_m > MAX_PIN_DISTANCE_FROM_CITY_M) {
    throw new AppError(422, 'PIN_TOO_FAR_FROM_CITY', 'The map pin is too far from the chosen city', {
      distanceM: Math.round(city.distance_m),
      maxDistanceM: MAX_PIN_DISTANCE_FROM_CITY_M,
    });
  }
}

module.exports = {
  listConfiguredCities,
  createCity,
  assertPinNearCity,
  MAX_PIN_DISTANCE_FROM_CITY_M,
};

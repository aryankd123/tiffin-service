-- City centres and India-only location checks.
-- 1. Each city gets a centre point. An address or restaurant pin must lie within 50 km of the
--    centre of the city it claims (checked in the service). A city without a centre can't
--    take addresses or restaurants until an admin sets one.
-- 2. Tiffin is India-only. The API rejects pins outside the box with a 400; these CHECKs
--    are the last line of defence, so a swapped lat/lng can never be stored, whatever the code does.
-- Schema only: centres for existing cities are filled in by scripts/seed.js, not here.

ALTER TABLE cities ADD COLUMN centre geography(Point, 4326);

ALTER TABLE cities ADD CONSTRAINT cities_centre_in_india CHECK (
  centre IS NULL OR (
    ST_Y(centre::geometry) BETWEEN 6 AND 38 AND ST_X(centre::geometry) BETWEEN 68 AND 98
  )
);

ALTER TABLE addresses ADD CONSTRAINT addresses_location_in_india CHECK (
  ST_Y(location::geometry) BETWEEN 6 AND 38 AND ST_X(location::geometry) BETWEEN 68 AND 98
);

ALTER TABLE restaurants ADD CONSTRAINT restaurants_location_in_india CHECK (
  ST_Y(location::geometry) BETWEEN 6 AND 38 AND ST_X(location::geometry) BETWEEN 68 AND 98
);

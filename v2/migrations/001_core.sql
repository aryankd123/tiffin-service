CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE cities (
  id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name  TEXT NOT NULL,
  state TEXT NOT NULL,
  UNIQUE (name, state)
);

CREATE TABLE users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  password_hash TEXT,
  google_sub    TEXT UNIQUE,
  role          TEXT NOT NULL DEFAULT 'customer'
                CHECK (role IN ('customer', 'vendor_admin', 'admin')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_has_login_method
    CHECK (password_hash IS NOT NULL OR google_sub IS NOT NULL)
);
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

CREATE TABLE addresses (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id),
  label         TEXT NOT NULL,
  contact_name  TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  line1         TEXT NOT NULL,
  line2         TEXT,
  city_id       BIGINT NOT NULL REFERENCES cities(id),
  postal_code   TEXT NOT NULL,
  location      geography(Point, 4326) NOT NULL,
  is_default    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX addresses_user_idx ON addresses (user_id);
CREATE UNIQUE INDEX addresses_one_default_idx ON addresses (user_id) WHERE is_default;

CREATE TABLE restaurants (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_user_id     BIGINT NOT NULL REFERENCES users(id),
  city_id           BIGINT NOT NULL REFERENCES cities(id),
  name              TEXT NOT NULL,
  location          geography(Point, 4326) NOT NULL,
  delivery_radius_m INTEGER NOT NULL CHECK (delivery_radius_m BETWEEN 500 AND 15000),
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, city_id)
);
CREATE INDEX restaurants_location_gix ON restaurants USING GIST (location);
CREATE INDEX restaurants_city_idx ON restaurants (city_id);
CREATE INDEX restaurants_owner_idx ON restaurants (owner_user_id);

CREATE TABLE menu_items (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES restaurants(id),
  name          TEXT NOT NULL,
  description   TEXT,
  price_paise   INTEGER NOT NULL CHECK (price_paise > 0),
  is_vegetarian BOOLEAN NOT NULL DEFAULT false,
  is_available  BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (restaurant_id, name)
);


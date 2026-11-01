CREATE TABLE subscription_plans (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES restaurants(id),
  name          TEXT NOT NULL,
  description   TEXT,
  price_paise   INTEGER NOT NULL CHECK (price_paise > 0),
  duration_days INTEGER NOT NULL CHECK (duration_days > 0),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (restaurant_id, name)
);

CREATE TABLE subscriptions (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id              BIGINT NOT NULL REFERENCES users(id),
  plan_id              BIGINT NOT NULL REFERENCES subscription_plans(id),
  address_id           BIGINT NOT NULL REFERENCES addresses(id),
  status               TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','paused','cancelled','expired')),
  plan_name_snapshot   TEXT NOT NULL,
  price_paise_snapshot INTEGER NOT NULL CHECK (price_paise_snapshot > 0),
  start_date           DATE NOT NULL,
  end_date             DATE NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date > start_date)
);

CREATE INDEX subscriptions_user_idx ON subscriptions (user_id, status);
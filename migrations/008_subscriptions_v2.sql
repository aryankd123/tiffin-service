-- Subscriptions with meal-count plans, delivery weekdays, skips and daily deliveries, and the
-- 'system' actor that scheduled jobs use in order history.
-- UPDATEs backfill rows created before this migration (test rows in dev); on an empty
-- database they change nothing.

-- Plans: a number of meals for one meal slot, lunch or dinner.
ALTER TABLE subscription_plans RENAME COLUMN duration_days TO meals_count;
ALTER TABLE subscription_plans DROP CONSTRAINT subscription_plans_duration_days_check;
ALTER TABLE subscription_plans ADD CONSTRAINT subscription_plans_meals_count_check
  CHECK (meals_count BETWEEN 1 AND 60);
ALTER TABLE subscription_plans ADD COLUMN meal_slot TEXT NOT NULL DEFAULT 'lunch'
  CONSTRAINT subscription_plans_meal_slot_check CHECK (meal_slot IN ('lunch', 'dinner'));
ALTER TABLE subscription_plans ALTER COLUMN meal_slot DROP DEFAULT;

-- Subscriptions: copy what was bought (snapshots, like orders) and the picked weekdays.
ALTER TABLE subscriptions ADD COLUMN meal_slot TEXT;
ALTER TABLE subscriptions ADD COLUMN meals_total INTEGER;
ALTER TABLE subscriptions ADD COLUMN delivery_weekdays SMALLINT[];  -- ISO weekdays: 1 = Mon … 7 = Sun
ALTER TABLE subscriptions ADD COLUMN cancelled_at TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN cancelled_by_actor TEXT
  CONSTRAINT subscriptions_cancelled_by_actor_check
  CHECK (cancelled_by_actor IN ('customer', 'restaurant', 'admin'));
ALTER TABLE subscriptions ADD COLUMN cancel_reason TEXT
  CONSTRAINT subscriptions_cancel_reason_check CHECK (char_length(cancel_reason) <= 200);

-- Old rows delivered every day.
UPDATE subscriptions s
SET meal_slot = p.meal_slot, meals_total = p.meals_count, delivery_weekdays = '{1,2,3,4,5,6,7}'
FROM subscription_plans p
WHERE p.id = s.plan_id AND s.meal_slot IS NULL;

ALTER TABLE subscriptions ALTER COLUMN meal_slot SET NOT NULL;
ALTER TABLE subscriptions ALTER COLUMN meals_total SET NOT NULL;
ALTER TABLE subscriptions ALTER COLUMN delivery_weekdays SET NOT NULL;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_meal_slot_check
  CHECK (meal_slot IN ('lunch', 'dinner'));
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_meals_total_check
  CHECK (meals_total BETWEEN 1 AND 60);
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_weekdays_check
  CHECK (cardinality(delivery_weekdays) BETWEEN 1 AND 7
         AND delivery_weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]);

-- Status: pauses are now dates, so 'paused' goes; 'expired' becomes 'completed'
-- (all meals delivered).
ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_status_check;
UPDATE subscriptions SET status = 'active' WHERE status = 'paused';
UPDATE subscriptions SET status = 'completed' WHERE status = 'expired';
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('active', 'completed', 'cancelled'));
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_cancel_consistent
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL));

-- end_date: the date of the last delivery, known only once the subscription has ended
-- (skips and pauses move it).
ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_check;
ALTER TABLE subscriptions ALTER COLUMN end_date DROP NOT NULL;
UPDATE subscriptions SET end_date = NULL WHERE status = 'active';
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_end_after_start
  CHECK (end_date IS NULL OR end_date >= start_date);

-- Several subscriptions are fine, but not two active ones to the same plan for the
-- same address (an address belongs to one user, so this is also per user).
CREATE UNIQUE INDEX subscriptions_one_active_per_plan_address
  ON subscriptions (plan_id, address_id) WHERE status = 'active';

-- Skips and pauses: one row per delivery date that won't be delivered.
-- A pause is stored as one row for each of its delivery days.
CREATE TABLE subscription_skips (
  subscription_id BIGINT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  skip_date       DATE NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('skip', 'pause')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (subscription_id, skip_date)
);

-- Daily deliveries: created by the nightly job for the next day. Delivery details
-- are snapshots of the address at that moment (like orders).
CREATE TABLE subscription_deliveries (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subscription_id   BIGINT NOT NULL REFERENCES subscriptions(id),
  restaurant_id     BIGINT NOT NULL REFERENCES restaurants(id),
  delivery_date     DATE NOT NULL,
  meal_slot         TEXT NOT NULL CHECK (meal_slot IN ('lunch', 'dinner')),
  status            TEXT NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled', 'delivered', 'missed')),
  contact_name      TEXT NOT NULL,
  contact_phone     TEXT NOT NULL,
  delivery_line     TEXT NOT NULL,
  delivery_location geography(Point, 4326) NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ,
  -- One delivery per subscription per day: makes the nightly job safe to run twice.
  CONSTRAINT subscription_deliveries_one_per_day UNIQUE (subscription_id, delivery_date)
);
-- The restaurant's head-count for a date.
CREATE INDEX subscription_deliveries_restaurant_date_idx
  ON subscription_deliveries (restaurant_id, delivery_date);

-- Scheduled jobs act as 'system', with no user behind them.
ALTER TABLE order_status_history ALTER COLUMN changed_by_user_id DROP NOT NULL;
ALTER TABLE order_status_history DROP CONSTRAINT order_status_history_actor_check;
ALTER TABLE order_status_history ADD CONSTRAINT order_status_history_actor_check
  CHECK (actor IN ('customer', 'restaurant', 'admin', 'system'));
ALTER TABLE order_status_history ADD CONSTRAINT order_status_history_system_has_no_user
  CHECK ((actor = 'system') = (changed_by_user_id IS NULL));

-- Online payment at checkout and refunds.

-- Orders: an order now starts as 'awaiting_payment' and reaches the restaurant ('pending') only
-- after payment. Unpaid for 15 minutes → 'expired'.
ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN (
  'awaiting_payment', 'expired',
  'pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'));
ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'awaiting_payment';

ALTER TABLE order_status_history DROP CONSTRAINT order_status_history_from_status_check;
ALTER TABLE order_status_history ADD CONSTRAINT order_status_history_from_status_check CHECK (from_status IN (
  'awaiting_payment', 'expired',
  'pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'));
ALTER TABLE order_status_history DROP CONSTRAINT order_status_history_to_status_check;
ALTER TABLE order_status_history ADD CONSTRAINT order_status_history_to_status_check CHECK (to_status IN (
  'awaiting_payment', 'expired',
  'pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'));

-- The transition trigger learns the three new moves.
CREATE OR REPLACE FUNCTION orders_check_status_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND (OLD.status, NEW.status) NOT IN (
       ('awaiting_payment', 'pending'), ('awaiting_payment', 'expired'), ('awaiting_payment', 'cancelled'),
       ('pending', 'confirmed'), ('pending', 'cancelled'),
       ('confirmed', 'preparing'), ('confirmed', 'cancelled'),
       ('preparing', 'out_for_delivery'),
       ('out_for_delivery', 'delivered')
     ) THEN
    RAISE EXCEPTION 'illegal order status transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'orders_status_transition';
  END IF;
  RETURN NEW;
END;
$$;

-- Subscriptions are paid upfront: 'awaiting_payment' → 'active', or 'expired' if unpaid.
ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_status_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check CHECK (status IN (
  'awaiting_payment', 'expired', 'active', 'completed', 'cancelled'));
-- The one-per-plan-and-address rule must also stop a second subscription while the first is still being paid for.
DROP INDEX subscriptions_one_active_per_plan_address;
CREATE UNIQUE INDEX subscriptions_one_active_per_plan_address
  ON subscriptions (plan_id, address_id) WHERE status IN ('awaiting_payment', 'active');

-- One payment per order or subscription. The gateway order is created at checkout; the customer
-- may retry inside the same gateway order, so one row is enough.
CREATE TABLE payments (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id           BIGINT REFERENCES orders(id),
  subscription_id    BIGINT REFERENCES subscriptions(id),
  provider           TEXT NOT NULL CHECK (provider IN ('razorpay', 'fake')),
  gateway_order_id   TEXT NOT NULL UNIQUE,
  gateway_payment_id TEXT UNIQUE,
  amount_paise       INTEGER NOT NULL CHECK (amount_paise > 0),
  currency           TEXT NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  status             TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'expired')),
  paid_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Pays for exactly one thing.
  CONSTRAINT payments_one_target CHECK ((order_id IS NULL) <> (subscription_id IS NULL)),
  -- 'paid' always comes with the gateway's payment id and a time.
  CONSTRAINT payments_paid_consistent
    CHECK ((status = 'paid') = (paid_at IS NOT NULL AND gateway_payment_id IS NOT NULL))
);
CREATE UNIQUE INDEX payments_one_per_order ON payments (order_id) WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX payments_one_per_subscription ON payments (subscription_id) WHERE subscription_id IS NOT NULL;
CREATE INDEX payments_open_idx ON payments (created_at) WHERE status = 'created';

-- At most one refund per payment (full for orders, pro rata for subscriptions). Recorded in the
-- same transaction as the cancellation; a job sends it to the gateway afterwards.
CREATE TABLE refunds (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id        BIGINT NOT NULL UNIQUE REFERENCES payments(id),
  amount_paise      INTEGER NOT NULL CHECK (amount_paise > 0),
  reason            TEXT NOT NULL CHECK (char_length(reason) <= 200),
  status            TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'processed', 'failed')),
  gateway_refund_id TEXT UNIQUE,
  attempts          INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at      TIMESTAMPTZ,
  CONSTRAINT refunds_processed_consistent
    CHECK ((status = 'processed') = (processed_at IS NOT NULL AND gateway_refund_id IS NOT NULL))
);
CREATE INDEX refunds_requested_idx ON refunds (created_at) WHERE status = 'requested';

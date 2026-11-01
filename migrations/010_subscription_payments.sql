-- Subscriptions paid upfront, pro-rata refunds, webhooks,
-- and database backstops for refunds and subscription statuses.

-- A new subscription waits for its payment, like an order.
ALTER TABLE subscriptions ALTER COLUMN status SET DEFAULT 'awaiting_payment';

-- Allowed subscription status changes, enforced like the order trigger. The service uses
-- compare-and-set updates; this catches code or SQL that bypasses it.
CREATE FUNCTION subscriptions_check_status_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND (OLD.status, NEW.status) NOT IN (
       ('awaiting_payment', 'active'), ('awaiting_payment', 'expired'), ('awaiting_payment', 'cancelled'),
       ('active', 'completed'), ('active', 'cancelled')
     ) THEN
    RAISE EXCEPTION 'illegal subscription status transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'subscriptions_status_transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER subscriptions_status_transition
  BEFORE UPDATE OF status ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION subscriptions_check_status_transition();

-- A refund must be for a paid payment and can't exceed it. Subscription refunds are
-- partial, so the amount is no longer always copied from the payment. A CHECK can't look
-- at another table, so this is a trigger.
CREATE FUNCTION refunds_check_payment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  p payments%ROWTYPE;
BEGIN
  SELECT * INTO p FROM payments WHERE id = NEW.payment_id;
  IF p.status <> 'paid' THEN
    RAISE EXCEPTION 'payment % is %, not paid', p.id, p.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'refunds_payment_is_paid';
  END IF;
  IF NEW.amount_paise > p.amount_paise THEN
    RAISE EXCEPTION 'refund of % paise exceeds payment of % paise', NEW.amount_paise, p.amount_paise
      USING ERRCODE = 'check_violation', CONSTRAINT = 'refunds_amount_within_payment';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER refunds_check_payment
  BEFORE INSERT OR UPDATE OF payment_id, amount_paise ON refunds
  FOR EACH ROW EXECUTE FUNCTION refunds_check_payment();

-- Webhook events already handled. Written after an event is processed, so a retry of an
-- event whose processing failed is processed again. Only ids are kept: the payload holds the
-- customer's email and phone, which Tiffin doesn't need to store.
CREATE TABLE payment_webhook_events (
  event_id           TEXT PRIMARY KEY CHECK (char_length(event_id) <= 100),
  event              TEXT NOT NULL CHECK (char_length(event) <= 100),
  gateway_payment_id TEXT,
  outcome            TEXT NOT NULL CHECK (char_length(outcome) <= 50),
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

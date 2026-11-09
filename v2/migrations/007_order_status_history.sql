-- Order status history and the status transition trigger.
-- Every status change is recorded (who, from, to, when, optional note), written in the same
--      transaction as the change itself. Gives each order a timeline and an audit trail.
-- The database rejects illegal transitions. A CHECK constraint can't compare a row's
--      old and new values; a BEFORE UPDATE trigger can. The service checks the same rules first,
--      so this only fires if some code path bypasses the service.

CREATE TABLE order_status_history (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id           BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status        TEXT CHECK (from_status IN
                       ('pending','confirmed','preparing','out_for_delivery','delivered','cancelled')),
  to_status          TEXT NOT NULL CHECK (to_status IN
                       ('pending','confirmed','preparing','out_for_delivery','delivered','cancelled')),
  changed_by_user_id BIGINT NOT NULL REFERENCES users(id),
  -- In what capacity the user acted. Needed later for refunds: a restaurant cancellation and a
  -- customer cancellation are treated differently.
  actor              TEXT NOT NULL CHECK (actor IN ('customer', 'restaurant', 'admin')),
  note               TEXT CHECK (char_length(note) <= 200),
  changed_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX order_status_history_order_idx ON order_status_history (order_id, changed_at, id);

-- Orders created before this migration get their "created" entry, attributed to the customer.
INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id, actor, changed_at)
SELECT id, NULL, status, user_id, 'customer', created_at FROM orders;

CREATE FUNCTION orders_check_status_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND (OLD.status, NEW.status) NOT IN (
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

CREATE TRIGGER orders_status_transition
  BEFORE UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_check_status_transition();

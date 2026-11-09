-- Delivery fees, order totals, item name snapshots and idempotency fingerprints.
-- Each restaurant charges a flat delivery fee; every order copies it, and the database
--      guarantees total = subtotal + fee.
-- Orders remember a fingerprint (SHA-256) of the request that created them, so reusing an
--      Idempotency-Key with a different body can be detected.
-- Order items remember the dish name at the time of ordering (prices were already snapshots).
-- The UPDATEs backfill rows created before this migration (test rows in dev); on an empty
-- database they change nothing.

ALTER TABLE restaurants
  ADD COLUMN delivery_fee_paise INTEGER NOT NULL DEFAULT 0
  CONSTRAINT restaurants_delivery_fee_range CHECK (delivery_fee_paise BETWEEN 0 AND 20000);

ALTER TABLE orders ADD COLUMN subtotal_paise INTEGER;
ALTER TABLE orders ADD COLUMN delivery_fee_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN request_hash TEXT;

UPDATE orders SET subtotal_paise = total_paise WHERE subtotal_paise IS NULL;
UPDATE orders SET request_hash = 'before-migration-006' WHERE request_hash IS NULL;

ALTER TABLE orders ALTER COLUMN subtotal_paise SET NOT NULL;
ALTER TABLE orders ALTER COLUMN request_hash SET NOT NULL;
-- The default only existed to backfill old rows; new orders must state their fee explicitly.
ALTER TABLE orders ALTER COLUMN delivery_fee_paise DROP DEFAULT;

ALTER TABLE orders ADD CONSTRAINT orders_subtotal_nonneg CHECK (subtotal_paise >= 0);
ALTER TABLE orders ADD CONSTRAINT orders_fee_nonneg CHECK (delivery_fee_paise >= 0);
ALTER TABLE orders ADD CONSTRAINT orders_total_is_sum
  CHECK (total_paise = subtotal_paise + delivery_fee_paise);

ALTER TABLE order_items ADD COLUMN item_name TEXT;
UPDATE order_items oi SET item_name = m.name
FROM menu_items m
WHERE m.id = oi.menu_item_id AND oi.item_name IS NULL;
ALTER TABLE order_items ALTER COLUMN item_name SET NOT NULL;

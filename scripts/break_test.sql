-- 1. User with neither password_hash nor google_sub
INSERT INTO users (name, email) VALUES ('No Login', 'nologin@x.com');

-- 2. Second user with uppercase email matching existing 'owner@x.com'
INSERT INTO users (name, email, password_hash) VALUES ('Dup Owner', 'OWNER@x.com', 'hash');

-- 3a. Two users with the same google_sub
INSERT INTO users (name, email, google_sub) VALUES ('G1', 'g1@x.com', 'sub_123');
INSERT INTO users (name, email, google_sub) VALUES ('G2', 'g2@x.com', 'sub_123');

-- 3b. Two users with google_sub NULL (Note: owner@x.com and cust@x.com already have google_sub = NULL! Try one more:)
INSERT INTO users (name, email, password_hash, google_sub) VALUES ('NullSub', 'nullsub@x.com', 'hash', NULL);

-- 4. Invalid role 'superuser'
INSERT INTO users (name, email, password_hash, role) VALUES ('Hacker', 'hack@x.com', 'hash', 'superuser');

-- 5. Restaurant with delivery_radius_m = 100 (too small), then 20000 (too large)
INSERT INTO restaurants (owner_user_id, city_id, name, location, delivery_radius_m)
VALUES (1, 2, 'Tiny Radius', ST_SetSRID(ST_MakePoint(77.2090, 28.6139), 4326)::geography, 100);

INSERT INTO restaurants (owner_user_id, city_id, name, location, delivery_radius_m)
VALUES (1, 2, 'Huge Radius', ST_SetSRID(ST_MakePoint(77.2090, 28.6139), 4326)::geography, 20000);

-- 6. Address with non-existent user_id = 999, then non-existent city_id = 999
INSERT INTO addresses (user_id, label, contact_name, contact_phone, line1, city_id, postal_code, location)
VALUES (999, 'BadUser', 'Test', '000', 'Line', 1, '560001', ST_SetSRID(ST_MakePoint(77.5946, 12.9716), 4326)::geography);

INSERT INTO addresses (user_id, label, contact_name, contact_phone, line1, city_id, postal_code, location)
VALUES (2, 'BadCity', 'Test', '000', 'Line', 999, '560001', ST_SetSRID(ST_MakePoint(77.5946, 12.9716), 4326)::geography);

-- 7. Second address for user 2 with is_default = true (should fail partial unique index!), then is_default = false (should succeed!)
INSERT INTO addresses (user_id, label, contact_name, contact_phone, line1, city_id, postal_code, location, is_default)
VALUES (2, 'Home 2', 'Cust One', '000', 'Line 2', 1, '560001', ST_SetSRID(ST_MakePoint(77.5946, 12.9716), 4326)::geography, true);

INSERT INTO addresses (user_id, label, contact_name, contact_phone, line1, city_id, postal_code, location, is_default)
VALUES (2, 'Office', 'Cust One', '000', 'Line 3', 1, '560001', ST_SetSRID(ST_MakePoint(77.5946, 12.9716), 4326)::geography, false);

-- 8. Menu item with price_paise = 0, then duplicate dish name in the same restaurant
INSERT INTO menu_items (restaurant_id, name, price_paise) VALUES (1, 'Free Thali', 0);

INSERT INTO menu_items (restaurant_id, name, price_paise) VALUES (1, 'Standard Thali', 12000);
INSERT INTO menu_items (restaurant_id, name, price_paise) VALUES (1, 'Standard Thali', 15000);

-- 9. Try to delete User 1 (who owns restaurant 1)
DELETE FROM users WHERE id = 1;

-- 10. THE SWAP TRAP: ST_MakePoint takes (lng, lat).
-- 10a: Pass Bengaluru (lat=12.9716, lng=77.5946) in swapped order:
INSERT INTO addresses (user_id, label, contact_name, contact_phone, line1, city_id, postal_code, location, is_default)
VALUES (2, 'Swapped BLR', 'Cust One', '000', 'Swap 1', 1, '560001', ST_SetSRID(ST_MakePoint(12.9716, 77.5946), 4326)::geography, false);

-- 10b: Pass Guwahati (lat=26.1445, lng=91.7362) in swapped order:
INSERT INTO addresses (user_id, label, contact_name, contact_phone, line1, city_id, postal_code, location, is_default)
VALUES (2, 'Swapped GHY', 'Cust One', '000', 'Swap 2', 3, '781001', ST_SetSRID(ST_MakePoint(26.1445, 91.7362), 4326)::geography, false);

-- Inspect the stored coordinates:
SELECT id, label, ST_AsText(location::geometry) AS wkt FROM addresses;

-- 11. Check the id of the rows in users and addresses after failed inserts — notice the gaps in the sequence!
SELECT id, email FROM users;

INSERT INTO addresses (user_id, label, contact_name, contact_phone, line1, city_id, postal_code, location, is_default)
VALUES (2, 'Parents Delhi', 'Parents', '9999999999', 'Connaught Place', 2, '110001',
        ST_SetSRID(ST_MakePoint(77.2100, 28.6140), 4326)::geography, false)
RETURNING id;

EXPLAIN (ANALYZE, BUFFERS)
SELECT r.id, r.name, ST_Distance(r.location, a.location) AS distance_m
FROM addresses a
JOIN restaurants r
  ON r.is_active
 AND ST_DWithin(r.location, a.location, 15000)
 AND ST_Distance(r.location, a.location) <= r.delivery_radius_m
WHERE a.id = 1 AND a.user_id = 2
ORDER BY distance_m
LIMIT 20;

INSERT INTO restaurants (owner_user_id, city_id, name, location, delivery_radius_m)
SELECT 1, 1, 'bulk ' || g,
       ST_SetSRID(ST_MakePoint(68 + random()*29, 8 + random()*27), 4326)::geography,
       3000
FROM generate_series(1, 100000) AS g;

ANALYZE restaurants;

-- 3A: With constant 15000 prefilter
EXPLAIN (ANALYZE, BUFFERS)
SELECT r.id, r.name, ST_Distance(r.location, a.location) AS distance_m
FROM addresses a
JOIN restaurants r
  ON r.is_active
 AND ST_DWithin(r.location, a.location, 15000)
 AND ST_Distance(r.location, a.location) <= r.delivery_radius_m
WHERE a.id = 1 AND a.user_id = 2
ORDER BY distance_m
LIMIT 20;

-- 3B: With per-row r.delivery_radius_m inside ST_DWithin
EXPLAIN (ANALYZE, BUFFERS)
SELECT r.id, r.name, ST_Distance(r.location, a.location) AS distance_m
FROM addresses a
JOIN restaurants r
  ON r.is_active
 AND ST_DWithin(r.location, a.location, r.delivery_radius_m)
WHERE a.id = 1 AND a.user_id = 2
ORDER BY distance_m
LIMIT 20;

DELETE FROM restaurants WHERE name LIKE 'bulk %';
DELETE FROM addresses WHERE label = 'Swapped BLR';



-- Setup: Create a second restaurant in Bengaluru (city_id = 1) with its own menu item
INSERT INTO restaurants (owner_user_id, city_id, name, location, delivery_radius_m)
VALUES (1, 1, 'BLR Tiffins', ST_SetSRID(ST_MakePoint(77.5946, 12.9716), 4326)::geography, 5000)
RETURNING id, city_id, name;

-- Insert a menu item for Restaurant 2 (check the returned restaurant id if it's not 2!)
INSERT INTO menu_items (restaurant_id, name, price_paise)
VALUES ((SELECT id FROM restaurants WHERE name = 'BLR Tiffins'), 'BLR Masala Dosa', 8000)
RETURNING id, restaurant_id, name;

-- TEST 1 (Composite FK): Try to create an order for Restaurant 1 (which is in Delhi, city_id = 2)
-- but pass city_id = 1 (Bengaluru). Should FAIL fk_order_restaurant!
INSERT INTO orders (user_id, restaurant_id, city_id, address_id, contact_name, contact_phone, delivery_line, delivery_location, total_paise, idempotency_key)
VALUES (2, 1, 1, 1, 'Cust One', '000', 'Line', ST_SetSRID(ST_MakePoint(77.2090, 28.6139), 4326)::geography, 12000, 'idem-bad-city');

-- TEST 2 (Valid Order + Idempotency Key): Insert a valid order for Restaurant 1 (city_id = 2),
-- then run the exact same INSERT a second time with the same (user_id, idempotency_key). Second should FAIL UNIQUE!
INSERT INTO orders (user_id, restaurant_id, city_id, address_id, contact_name, contact_phone, delivery_line, delivery_location, total_paise, idempotency_key)
VALUES (2, 1, 2, 1, 'Parents', '999', 'CP Delhi', ST_SetSRID(ST_MakePoint(77.2100, 28.6140), 4326)::geography, 12000, 'idem-key-001')
RETURNING id;

-- Run the duplicate idempotency_key for User 2 (should FAIL orders_user_id_idempotency_key_key):
INSERT INTO orders (user_id, restaurant_id, city_id, address_id, contact_name, contact_phone, delivery_line, delivery_location, total_paise, idempotency_key)
VALUES (2, 1, 2, 1, 'Parents', '999', 'CP Delhi', ST_SetSRID(ST_MakePoint(77.2100, 28.6140), 4326)::geography, 12000, 'idem-key-001');

-- TEST 3 (Cross-Restaurant / Cross-City Menu Item Trap):
-- Try to add BLR Masala Dosa (from BLR Tiffins) into Order 1 (which is for Delhi Tiffins, restaurant_id = 1):
-- Case 3A: Pass restaurant_id = 1 -> Fails fk_order_items_menu!
INSERT INTO order_items (order_id, restaurant_id, menu_item_id, quantity, unit_price_paise)
VALUES (
  (SELECT id FROM orders WHERE idempotency_key = 'idem-key-001'),
  1,
  (SELECT id FROM menu_items WHERE name = 'BLR Masala Dosa'),
  1, 8000
);

-- Case 3B: Pass BLR Tiffins' restaurant_id -> Fails fk_order_items_header!
INSERT INTO order_items (order_id, restaurant_id, menu_item_id, quantity, unit_price_paise)
VALUES (
  (SELECT id FROM orders WHERE idempotency_key = 'idem-key-001'),
  (SELECT id FROM restaurants WHERE name = 'BLR Tiffins'),
  (SELECT id FROM menu_items WHERE name = 'BLR Masala Dosa'),
  1, 8000
);

-- TEST 4 (Snapshot Preservation on Address Delete):
-- Insert a temporary address, point an order to it, then DELETE the address.
-- Verify the order survives with address_id = NULL and delivery_line / delivery_location intact!
INSERT INTO addresses (user_id, label, contact_name, contact_phone, line1, city_id, postal_code, location)
VALUES (2, 'Temp Addr', 'Temp', '111', 'Temp Street 42', 2, '110001', ST_SetSRID(ST_MakePoint(77.2100, 28.6140), 4326)::geography)
RETURNING id;

--TEST 5 (Subscription Date Invariant): Try inserting a subscription where end_date <= start_date
INSERT INTO subscription_plans (restaurant_id, name, price_paise, duration_days)
VALUES (1, 'Monthly Lunch', 300000, 30)
RETURNING id;

INSERT INTO subscriptions (user_id, plan_id, address_id, plan_name_snapshot, price_paise_snapshot, start_date, end_date)
VALUES (2, 1, 1, 'Monthly Lunch', 300000, '2026-11-10', '2026-11-01');
-- Add composite unique target on menu_items so order_items can verify (menu_item_id, restaurant_id)
ALTER TABLE menu_items
  ADD CONSTRAINT menu_items_id_restaurant_uq UNIQUE (id, restaurant_id);

CREATE TABLE orders (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id           BIGINT NOT NULL REFERENCES users(id),
  restaurant_id     BIGINT NOT NULL,
  city_id           BIGINT NOT NULL,
  address_id        BIGINT REFERENCES addresses(id) ON DELETE SET NULL,
  contact_name      TEXT NOT NULL,                       -- snapshot
  contact_phone     TEXT NOT NULL,                       -- snapshot
  delivery_line     TEXT NOT NULL,                       -- snapshot
  delivery_location geography(Point, 4326) NOT NULL,     -- snapshot
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','confirmed','preparing','out_for_delivery','delivered','cancelled')),
  total_paise       INTEGER NOT NULL CHECK (total_paise >= 0),
  idempotency_key   TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, idempotency_key),

  -- 1. Link order to restaurant AND guarantee order.city_id == restaurant.city_id
  CONSTRAINT fk_order_restaurant
    FOREIGN KEY (restaurant_id, city_id)
    REFERENCES restaurants (id, city_id),

  -- 2. Composite target so order_items can verify order_id + restaurant_id
  CONSTRAINT unique_order_restaurant
    UNIQUE (id, restaurant_id)
);

CREATE INDEX orders_user_created_idx ON orders (user_id, created_at DESC, id DESC);
CREATE INDEX orders_restaurant_created_idx ON orders (restaurant_id, created_at DESC, id DESC);

CREATE TABLE order_items (
  order_id         BIGINT NOT NULL,
  restaurant_id    BIGINT NOT NULL,
  menu_item_id     BIGINT NOT NULL,
  quantity         INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  unit_price_paise INTEGER NOT NULL CHECK (unit_price_paise > 0), -- snapshot

  PRIMARY KEY (order_id, menu_item_id),

  -- 3. Force item's restaurant_id to match its parent order's restaurant_id
  CONSTRAINT fk_order_items_header
    FOREIGN KEY (order_id, restaurant_id)
    REFERENCES orders (id, restaurant_id) ON DELETE CASCADE,

  -- 4. Force menu_item_id to actually belong to that exact restaurant_id
  CONSTRAINT fk_order_items_menu
    FOREIGN KEY (menu_item_id, restaurant_id)
    REFERENCES menu_items (id, restaurant_id)
);
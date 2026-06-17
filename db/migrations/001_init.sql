CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS staff_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL DEFAULT 'validator',
  status text NOT NULL DEFAULT 'invited',
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_users_role_check CHECK (role IN ('owner', 'admin', 'manager', 'validator', 'support')),
  CONSTRAINT staff_users_status_check CHECK (status IN ('invited', 'active', 'suspended', 'disabled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_users_email_lower_uidx ON staff_users (lower(email));
CREATE INDEX IF NOT EXISTS staff_users_status_idx ON staff_users (status);
CREATE INDEX IF NOT EXISTS staff_users_created_at_idx ON staff_users (created_at);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  session_token_hash text NOT NULL UNIQUE,
  ip_hash text,
  user_agent_hash text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_sessions_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS admin_sessions_staff_user_id_idx ON admin_sessions (staff_user_id);
CREATE INDEX IF NOT EXISTS admin_sessions_created_at_idx ON admin_sessions (created_at);

CREATE TABLE IF NOT EXISTS venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  city text NOT NULL,
  state text,
  country text NOT NULL DEFAULT 'MX',
  timezone text NOT NULL DEFAULT 'America/Mexico_City',
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venues_status_check CHECK (status IN ('active', 'inactive', 'archived'))
);

CREATE INDEX IF NOT EXISTS venues_status_idx ON venues (status);
CREATE INDEX IF NOT EXISTS venues_created_at_idx ON venues (created_at);

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text NOT NULL DEFAULT 'draft',
  currency char(3) NOT NULL DEFAULT 'MXN',
  capacity_total integer,
  external_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_status_check CHECK (status IN ('draft', 'published', 'on_sale', 'sold_out', 'cancelled', 'completed')),
  CONSTRAINT events_capacity_check CHECK (capacity_total IS NULL OR capacity_total >= 0),
  CONSTRAINT events_date_order_check CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at),
  CONSTRAINT events_venue_slug_unique UNIQUE (venue_id, slug)
);

CREATE INDEX IF NOT EXISTS events_venue_id_idx ON events (venue_id);
CREATE INDEX IF NOT EXISTS events_status_idx ON events (status);
CREATE INDEX IF NOT EXISTS events_created_at_idx ON events (created_at);

CREATE TABLE IF NOT EXISTS sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  section_type text NOT NULL DEFAULT 'seated',
  capacity_total integer,
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sections_type_check CHECK (section_type IN ('general', 'seated', 'table', 'vip', 'standing')),
  CONSTRAINT sections_status_check CHECK (status IN ('active', 'inactive', 'sold_out', 'archived')),
  CONSTRAINT sections_capacity_check CHECK (capacity_total IS NULL OR capacity_total >= 0),
  CONSTRAINT sections_event_code_unique UNIQUE (event_id, code)
);

CREATE INDEX IF NOT EXISTS sections_event_id_idx ON sections (event_id);
CREATE INDEX IF NOT EXISTS sections_status_idx ON sections (status);
CREATE INDEX IF NOT EXISTS sections_created_at_idx ON sections (created_at);

CREATE TABLE IF NOT EXISTS seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  section_id uuid NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  seat_code text NOT NULL,
  row_label text,
  seat_number integer,
  table_label text,
  table_seat_number integer,
  status text NOT NULL DEFAULT 'available',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seats_status_check CHECK (status IN ('available', 'held', 'sold', 'blocked', 'disabled')),
  CONSTRAINT seats_seat_number_check CHECK (seat_number IS NULL OR seat_number > 0),
  CONSTRAINT seats_table_seat_number_check CHECK (table_seat_number IS NULL OR table_seat_number > 0),
  CONSTRAINT seats_event_seat_code_unique UNIQUE (event_id, seat_code)
);

CREATE INDEX IF NOT EXISTS seats_event_id_idx ON seats (event_id);
CREATE INDEX IF NOT EXISTS seats_section_id_idx ON seats (section_id);
CREATE INDEX IF NOT EXISTS seats_status_idx ON seats (status);
CREATE INDEX IF NOT EXISTS seats_created_at_idx ON seats (created_at);
CREATE UNIQUE INDEX IF NOT EXISTS seats_event_section_position_uidx
  ON seats (event_id, section_id, row_label, seat_number)
  WHERE seat_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS ticket_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  price_cents integer NOT NULL,
  currency char(3) NOT NULL DEFAULT 'MXN',
  quantity_total integer,
  quantity_sold integer NOT NULL DEFAULT 0,
  sales_start_at timestamptz,
  sales_end_at timestamptz,
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ticket_types_status_check CHECK (status IN ('active', 'paused', 'sold_out', 'archived')),
  CONSTRAINT ticket_types_price_check CHECK (price_cents >= 0),
  CONSTRAINT ticket_types_quantity_check CHECK (quantity_total IS NULL OR quantity_total >= 0),
  CONSTRAINT ticket_types_quantity_sold_check CHECK (quantity_sold >= 0),
  CONSTRAINT ticket_types_sales_window_check CHECK (sales_end_at IS NULL OR sales_start_at IS NULL OR sales_end_at >= sales_start_at),
  CONSTRAINT ticket_types_event_code_unique UNIQUE (event_id, code)
);

CREATE INDEX IF NOT EXISTS ticket_types_event_id_idx ON ticket_types (event_id);
CREATE INDEX IF NOT EXISTS ticket_types_status_idx ON ticket_types (status);
CREATE INDEX IF NOT EXISTS ticket_types_created_at_idx ON ticket_types (created_at);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  buyer_email text NOT NULL,
  buyer_email_normalized text GENERATED ALWAYS AS (lower(buyer_email)) STORED,
  buyer_name text,
  buyer_phone text,
  status text NOT NULL DEFAULT 'pending_payment',
  subtotal_cents integer NOT NULL DEFAULT 0,
  fee_cents integer NOT NULL DEFAULT 0,
  discount_cents integer NOT NULL DEFAULT 0,
  total_cents integer NOT NULL DEFAULT 0,
  currency char(3) NOT NULL DEFAULT 'MXN',
  payment_method text NOT NULL DEFAULT 'unknown',
  checkout_quote_id text,
  public_order_token_hash text UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_status_check CHECK (status IN ('pending_payment', 'paid', 'cancelled', 'expired', 'refunded', 'partially_refunded', 'fulfilled')),
  CONSTRAINT orders_payment_method_check CHECK (payment_method IN ('tarjeta', 'spei', 'oxxo', 'card', 'cash', 'unknown')),
  CONSTRAINT orders_amounts_check CHECK (
    subtotal_cents >= 0 AND fee_cents >= 0 AND discount_cents >= 0 AND total_cents >= 0
  )
);

CREATE INDEX IF NOT EXISTS orders_buyer_email_idx ON orders (buyer_email_normalized);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at);

CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  ticket_type_id uuid REFERENCES ticket_types(id) ON DELETE RESTRICT,
  seat_id uuid REFERENCES seats(id) ON DELETE RESTRICT,
  unit_price_cents integer NOT NULL,
  fee_cents integer NOT NULL DEFAULT 0,
  total_cents integer NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_items_status_check CHECK (status IN ('pending', 'issued', 'cancelled', 'refunded')),
  CONSTRAINT order_items_amounts_check CHECK (unit_price_cents >= 0 AND fee_cents >= 0 AND total_cents >= 0),
  CONSTRAINT order_items_order_seat_unique UNIQUE (order_id, seat_id)
);

CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items (order_id);
CREATE INDEX IF NOT EXISTS order_items_event_id_idx ON order_items (event_id);
CREATE INDEX IF NOT EXISTS order_items_seat_id_idx ON order_items (seat_id);
CREATE INDEX IF NOT EXISTS order_items_status_idx ON order_items (status);
CREATE INDEX IF NOT EXISTS order_items_created_at_idx ON order_items (created_at);
CREATE UNIQUE INDEX IF NOT EXISTS order_items_active_seat_uidx
  ON order_items (seat_id)
  WHERE seat_id IS NOT NULL AND status IN ('pending', 'issued');

CREATE TABLE IF NOT EXISTS tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  order_item_id uuid UNIQUE REFERENCES order_items(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  seat_id uuid REFERENCES seats(id) ON DELETE RESTRICT,
  ticket_type_id uuid REFERENCES ticket_types(id) ON DELETE RESTRICT,
  ticket_code text NOT NULL UNIQUE,
  private_view_token_hash text NOT NULL UNIQUE,
  qr_token_hash text,
  status text NOT NULL DEFAULT 'issued',
  validation_count integer NOT NULL DEFAULT 0,
  issued_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT tickets_status_check CHECK (status IN ('issued', 'active', 'used', 'cancelled', 'refunded', 'void')),
  CONSTRAINT tickets_validation_count_check CHECK (validation_count >= 0)
);

CREATE INDEX IF NOT EXISTS tickets_order_id_idx ON tickets (order_id);
CREATE INDEX IF NOT EXISTS tickets_event_id_idx ON tickets (event_id);
CREATE INDEX IF NOT EXISTS tickets_seat_id_idx ON tickets (seat_id);
CREATE INDEX IF NOT EXISTS tickets_status_idx ON tickets (status);
CREATE INDEX IF NOT EXISTS tickets_created_at_idx ON tickets (created_at);
CREATE UNIQUE INDEX IF NOT EXISTS tickets_qr_token_hash_uidx
  ON tickets (qr_token_hash)
  WHERE qr_token_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tickets_active_seat_uidx
  ON tickets (seat_id)
  WHERE seat_id IS NOT NULL AND status IN ('issued', 'active', 'used');

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'manual',
  provider_payment_id text,
  method text NOT NULL DEFAULT 'unknown',
  status text NOT NULL DEFAULT 'pending',
  amount_cents integer NOT NULL,
  currency char(3) NOT NULL DEFAULT 'MXN',
  paid_at timestamptz,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_method_check CHECK (method IN ('card', 'tarjeta', 'spei', 'oxxo', 'cash', 'unknown')),
  CONSTRAINT payments_status_check CHECK (status IN ('requires_action', 'pending', 'authorized', 'paid', 'failed', 'cancelled', 'refunded', 'partially_refunded')),
  CONSTRAINT payments_amount_check CHECK (amount_cents >= 0)
);

CREATE INDEX IF NOT EXISTS payments_order_id_idx ON payments (order_id);
CREATE INDEX IF NOT EXISTS payments_status_idx ON payments (status);
CREATE INDEX IF NOT EXISTS payments_created_at_idx ON payments (created_at);
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_payment_uidx
  ON payments (provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  provider text NOT NULL,
  provider_event_id text,
  event_type text NOT NULL,
  signature_hash text,
  payload_hash text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'received',
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error_message text,
  CONSTRAINT payment_webhooks_status_check CHECK (status IN ('received', 'processed', 'failed', 'ignored'))
);

CREATE INDEX IF NOT EXISTS payment_webhooks_payment_id_idx ON payment_webhooks (payment_id);
CREATE INDEX IF NOT EXISTS payment_webhooks_status_idx ON payment_webhooks (status);
CREATE INDEX IF NOT EXISTS payment_webhooks_received_at_idx ON payment_webhooks (received_at);
CREATE UNIQUE INDEX IF NOT EXISTS payment_webhooks_provider_event_uidx
  ON payment_webhooks (provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS seat_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  seat_id uuid REFERENCES seats(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  reservation_token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'held',
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seat_reservations_status_check CHECK (status IN ('held', 'confirmed', 'released', 'expired', 'cancelled')),
  CONSTRAINT seat_reservations_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS seat_reservations_event_id_idx ON seat_reservations (event_id);
CREATE INDEX IF NOT EXISTS seat_reservations_order_id_idx ON seat_reservations (order_id);
CREATE INDEX IF NOT EXISTS seat_reservations_status_idx ON seat_reservations (status);
CREATE INDEX IF NOT EXISTS seat_reservations_created_at_idx ON seat_reservations (created_at);
CREATE UNIQUE INDEX IF NOT EXISTS seat_reservations_active_seat_uidx
  ON seat_reservations (seat_id)
  WHERE seat_id IS NOT NULL AND status = 'held';

CREATE TABLE IF NOT EXISTS ticket_validation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES tickets(id) ON DELETE SET NULL,
  event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  staff_user_id uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  validation_status text NOT NULL,
  qr_window bigint,
  qr_token_hash text,
  device_id text,
  ip_hash text,
  user_agent_hash text,
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT ticket_validation_logs_status_check CHECK (validation_status IN ('valid', 'invalid', 'duplicate', 'expired', 'cancelled', 'error'))
);

CREATE INDEX IF NOT EXISTS ticket_validation_logs_ticket_id_idx ON ticket_validation_logs (ticket_id);
CREATE INDEX IF NOT EXISTS ticket_validation_logs_event_id_idx ON ticket_validation_logs (event_id);
CREATE INDEX IF NOT EXISTS ticket_validation_logs_staff_user_id_idx ON ticket_validation_logs (staff_user_id);
CREATE INDEX IF NOT EXISTS ticket_validation_logs_status_idx ON ticket_validation_logs (validation_status);
CREATE INDEX IF NOT EXISTS ticket_validation_logs_created_at_idx ON ticket_validation_logs (created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_staff_user_id uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  actor_type text NOT NULL DEFAULT 'system',
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  request_id text,
  ip_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_logs_actor_type_check CHECK (actor_type IN ('system', 'staff', 'customer', 'integration'))
);

CREATE INDEX IF NOT EXISTS audit_logs_actor_staff_user_id_idx ON audit_logs (actor_staff_user_id);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs (action);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  email_normalized text GENERATED ALWAYS AS (lower(email)) STORED,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_normalized_key ON users (email_normalized);

CREATE TABLE IF NOT EXISTS user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS user_sessions_expires_at_idx ON user_sessions (expires_at);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS orders_user_id_idx ON orders (user_id);

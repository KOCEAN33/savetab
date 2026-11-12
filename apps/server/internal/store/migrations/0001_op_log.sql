CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The seq the user's next op takes. A push locks this row, so ops commit in seq order.
  next_seq bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE sessions (
  -- SHA-256 of the opaque token, so a database read does not yield a usable token.
  token_hash bytea PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES devices ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('access', 'refresh')),
  expires_at timestamptz NOT NULL
);

CREATE TABLE ops (
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  seq bigint NOT NULL,
  op_id uuid NOT NULL,
  device_id uuid NOT NULL REFERENCES devices ON DELETE CASCADE,
  ciphertext bytea NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, seq),
  UNIQUE (user_id, op_id)
);

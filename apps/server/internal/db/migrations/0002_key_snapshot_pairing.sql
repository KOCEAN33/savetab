CREATE TABLE key_wraps (
  user_id uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  -- The data key wrapped by the recovery key. The server holds neither key.
  wrapped_key bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE snapshots (
  user_id uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  -- The snapshot holds every op up to this seq. The log keeps only ops above it.
  seq bigint NOT NULL,
  ciphertext bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pairings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  new_device_id uuid NOT NULL REFERENCES devices ON DELETE CASCADE,
  commitment bytea NOT NULL,
  -- The messages arrive in this order, each set once.
  old_public bytea,
  new_public bytea,
  wrapped_key bytea,
  expires_at timestamptz NOT NULL
);

CREATE INDEX pairings_user_id ON pairings (user_id);

CREATE TABLE identities (
  issuer text NOT NULL,
  subject text NOT NULL,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  PRIMARY KEY (issuer, subject)
);

-- One login in flight, from /v1/auth/start until the client redeems its code.
CREATE TABLE logins (
  -- SHA-256 of the state the issuer echoes back.
  state_hash bytea PRIMARY KEY,
  redirect_uri text NOT NULL,
  client_state text NOT NULL,
  code_challenge text NOT NULL,
  nonce text NOT NULL,
  issuer_verifier text NOT NULL,
  -- Set once the issuer has named the user. SHA-256 of the code the client redeems.
  code_hash bytea UNIQUE,
  user_id uuid REFERENCES users ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

-- name: LockNextSeq :one
-- The seq the user's next op gets. It locks the user's row until the transaction ends.
SELECT next_seq FROM users WHERE id = @user_id::uuid FOR UPDATE;

-- name: InsertOps :execrows
-- Appends the ops in the given order from first_seq on, skipping an op id the user already
-- pushed. The filter runs before row_number, so a skipped op leaves no gap.
WITH fresh AS (
  SELECT i.op_id, c.ciphertext, row_number() OVER (ORDER BY i.ord) AS n
  FROM unnest(@op_ids::uuid[]) WITH ORDINALITY AS i (op_id, ord)
  INNER JOIN unnest(@ciphertexts::bytea[]) WITH ORDINALITY AS c (ciphertext, ord) ON i.ord = c.ord
  WHERE NOT EXISTS (SELECT 1 FROM ops AS o WHERE o.user_id = @user_id::uuid AND o.op_id = i.op_id)
)

INSERT INTO ops (user_id, seq, op_id, device_id, ciphertext)
SELECT @user_id::uuid, (@first_seq::bigint) + fresh.n - 1, fresh.op_id, @device_id::uuid, fresh.ciphertext
FROM fresh;

-- name: SetNextSeq :exec
UPDATE users SET next_seq = @next_seq::bigint WHERE id = @user_id::uuid;

-- name: SnapshotAbove :one
-- Whether the user has a snapshot at a seq above the given one.
SELECT (EXISTS (SELECT 1 FROM snapshots WHERE user_id = @user_id::uuid AND seq > @seq::bigint))::bool AS above;

-- name: OpsAfter :many
-- Up to max_ops of the user's ops with seq above after_seq, in seq order.
SELECT seq, op_id AS id, device_id, ciphertext, received_at
FROM ops
WHERE user_id = @user_id::uuid AND seq > @after_seq::bigint
ORDER BY seq
LIMIT @max_ops::int;

-- name: InsertDevice :one
INSERT INTO devices (user_id, name) VALUES (@user_id::uuid, @name::text) RETURNING id;

-- name: Devices :many
-- The user's devices that are not revoked, oldest first.
SELECT id, name, created_at
FROM devices
WHERE user_id = @user_id::uuid AND revoked_at IS NULL
ORDER BY created_at, id;

-- name: RevokeDevice :execrows
-- Revokes one of the user's devices that is not revoked yet, which ends its sessions.
UPDATE devices SET revoked_at = now()
WHERE id = @device_id::uuid AND user_id = @user_id::uuid AND revoked_at IS NULL;

-- name: InsertKey :execrows
-- Stores the user's wrapped data key unless the user has one.
INSERT INTO key_wraps (user_id, wrapped_key) VALUES (@user_id::uuid, @wrapped_key::bytea)
ON CONFLICT (user_id) DO NOTHING;

-- name: Key :one
SELECT wrapped_key FROM key_wraps WHERE user_id = @user_id::uuid;

-- name: UpsertSnapshot :execrows
-- Replaces the user's snapshot unless the stored one has a higher seq.
INSERT INTO snapshots (user_id, seq, ciphertext) VALUES (@user_id::uuid, @seq::bigint, @ciphertext::bytea)
ON CONFLICT (user_id) DO UPDATE SET seq = excluded.seq, ciphertext = excluded.ciphertext, created_at = now()
WHERE snapshots.seq <= excluded.seq;

-- name: DeleteOpsThrough :exec
-- Deletes the user's ops at or below the seq.
DELETE FROM ops WHERE user_id = @user_id::uuid AND seq <= @seq::bigint;

-- name: Snapshot :one
SELECT seq, ciphertext FROM snapshots WHERE user_id = @user_id::uuid;

-- name: InsertLogin :exec
-- Stores the login under the hash of its state and clears expired logins.
WITH gone AS (DELETE FROM logins WHERE expires_at <= now())

INSERT INTO logins (state_hash, redirect_uri, client_state, code_challenge, nonce, issuer_verifier, expires_at)
VALUES (
  @state_hash::bytea,
  @redirect_uri::text,
  @client_state::text,
  @code_challenge::text,
  @nonce::text,
  @issuer_verifier::text,
  now() + make_interval(secs => @ttl_seconds::float8)
);

-- name: PendingLogin :one
-- The login the state hash belongs to, unless it expired or the issuer already answered it.
SELECT redirect_uri, client_state, code_challenge, nonce, issuer_verifier
FROM logins
WHERE state_hash = @state_hash::bytea AND code_hash IS NULL AND expires_at > now();

-- name: LockIdentity :exec
-- Locks the identity until the transaction ends, whether or not it exists yet.
SELECT pg_advisory_xact_lock(hashtextextended(@issuer::text || ' ' || @subject::text, 0));

-- name: IdentityUser :one
SELECT user_id FROM identities WHERE issuer = @issuer::text AND subject = @subject::text;

-- name: InsertUser :one
INSERT INTO users DEFAULT VALUES RETURNING id;

-- name: InsertIdentity :exec
INSERT INTO identities (issuer, subject, user_id) VALUES (@issuer::text, @subject::text, @user_id::uuid);

-- name: SetLoginCode :execrows
-- Records the code and the user of a login that is still pending.
UPDATE logins SET code_hash = @code_hash::bytea, user_id = @user_id::uuid
WHERE state_hash = @state_hash::bytea AND code_hash IS NULL AND expires_at > now();

-- name: TakeLogin :one
-- Deletes the unexpired login the code hash belongs to. A login with a code has a user.
DELETE FROM logins
WHERE code_hash = @code_hash::bytea AND expires_at > now() AND user_id IS NOT NULL
RETURNING user_id::uuid AS user_id, code_challenge;

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
-- One page of the user's devices that are not revoked, oldest first, after the given position.
SELECT id, name, created_at
FROM devices
WHERE
  user_id = @user_id::uuid AND revoked_at IS NULL
  AND (created_at, id) > (@after_created_at::timestamptz, @after_id::uuid)
ORDER BY created_at, id
LIMIT @max_rows::int;

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
-- Replaces the user's snapshot with one of a higher seq.
INSERT INTO snapshots (user_id, seq, ciphertext) VALUES (@user_id::uuid, @seq::bigint, @ciphertext::bytea)
ON CONFLICT (user_id) DO UPDATE SET seq = excluded.seq, ciphertext = excluded.ciphertext, created_at = now()
WHERE snapshots.seq < excluded.seq;

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

-- name: InsertSessions :exec
-- Stores the access and the refresh session of one token pair.
INSERT INTO sessions (token_hash, device_id, kind, expires_at)
VALUES
(@access_hash::bytea, @device_id::uuid, 'access', now() + make_interval(secs => @access_ttl_seconds::float8)),
(@refresh_hash::bytea, @device_id::uuid, 'refresh', now() + make_interval(secs => @refresh_ttl_seconds::float8));

-- name: AccessSession :one
-- The device and user of an access token's session, unless it expired or the device is revoked.
SELECT d.id AS device_id, d.user_id
FROM sessions AS s
INNER JOIN devices AS d ON s.device_id = d.id
WHERE s.token_hash = @token_hash::bytea AND s.kind = 'access' AND s.expires_at > now() AND d.revoked_at IS NULL;

-- name: TakeRefreshSession :one
-- Deletes a refresh token's session, unless it expired or the device is revoked.
DELETE FROM sessions AS s
WHERE
  s.token_hash = @token_hash::bytea AND s.kind = 'refresh' AND s.expires_at > now()
  AND EXISTS (SELECT 1 FROM devices AS d WHERE d.id = s.device_id AND d.revoked_at IS NULL)
RETURNING s.device_id, (SELECT d.user_id FROM devices AS d WHERE d.id = s.device_id)::uuid AS user_id;

-- name: CreatePairing :one
-- Opens a pairing for the device, which is the new one. It replaces a pairing the device still
-- has open and clears the user's expired ones. A pairing that holds the id stays, so the insert
-- is a unique violation.
WITH gone AS (
  DELETE FROM pairings
  WHERE
    user_id = @user_id::uuid AND id <> @id::uuid
    AND (expires_at <= now() OR new_device_id = @new_device_id::uuid)
)

INSERT INTO pairings (id, user_id, new_device_id, commitment, expires_at)
VALUES (
  @id::uuid, @user_id::uuid, @new_device_id::uuid, @commitment::bytea,
  now() + make_interval(secs => @ttl_seconds::float8)
)
RETURNING
  id, new_device_id,
  (SELECT d.name FROM devices AS d WHERE d.id = @new_device_id::uuid)::text AS new_device_name,
  commitment, old_public, new_public, wrapped_key, expires_at;

-- name: Pairings :many
-- One page of the user's pairings that have not expired, oldest first, after the given position.
SELECT
  p.id, p.new_device_id, d.name AS new_device_name,
  p.commitment, p.old_public, p.new_public, p.wrapped_key, p.expires_at
FROM pairings AS p
INNER JOIN devices AS d ON p.new_device_id = d.id
WHERE
  p.user_id = @user_id::uuid AND p.expires_at > now()
  AND (p.expires_at, p.id) > (@after_expires_at::timestamptz, @after_id::uuid)
ORDER BY p.expires_at, p.id
LIMIT @max_rows::int;

-- name: Pairing :one
-- One of the user's pairings, unless it expired.
SELECT
  p.id, p.new_device_id, d.name AS new_device_name,
  p.commitment, p.old_public, p.new_public, p.wrapped_key, p.expires_at
FROM pairings AS p
INNER JOIN devices AS d ON p.new_device_id = d.id
WHERE p.id = @id::uuid AND p.user_id = @user_id::uuid AND p.expires_at > now();

-- name: LockPairing :one
-- Which messages one of the user's unexpired pairings holds. It locks the row until the
-- transaction ends.
SELECT
  new_device_id,
  (old_public IS NOT NULL)::bool AS has_old,
  (new_public IS NOT NULL)::bool AS has_new,
  (wrapped_key IS NOT NULL)::bool AS has_key
FROM pairings
WHERE id = @id::uuid AND user_id = @user_id::uuid AND expires_at > now()
FOR UPDATE;

-- name: InsertShare :one
-- Stores a share of the user's. It also clears every user's expired shares, so none outlives
-- the next share made on the server. A share that holds the id stays, so the insert is a
-- unique violation.
WITH gone AS (DELETE FROM shares WHERE expires_at <= now() AND id <> @id::uuid)

INSERT INTO shares (id, user_id, ciphertext, expires_at)
VALUES (@id::uuid, @user_id::uuid, @ciphertext::bytea, now() + make_interval(secs => @ttl_seconds::float8))
RETURNING id, ciphertext, expires_at;

-- name: Share :one
-- Any user's share, unless it expired.
SELECT id, ciphertext, expires_at FROM shares WHERE id = @id::uuid AND expires_at > now();

-- name: DeleteShare :execrows
-- Deletes one of the user's unexpired shares.
DELETE FROM shares WHERE id = @id::uuid AND user_id = @user_id::uuid AND expires_at > now();

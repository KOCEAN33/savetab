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

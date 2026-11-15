#!/usr/bin/env bash
# Holds internal/db/queries.sql and the code sqlc generates from it to their gates.
set -euo pipefail
cd "$(dirname "$0")/.."

sqlc diff
if grep -nE '\$[0-9]' internal/db/queries.sql; then
  echo "a query parameter is @name::type, never positional"; exit 1
fi
if grep -nE 'pgtype\.(UUID|Timestamptz|Text)' internal/db/db.go internal/db/models.go internal/db/*.sql.go; then
  echo "a generated type is missing its override in sqlc.yaml"; exit 1
fi
if grep -nE 'interface\{\}|Column[0-9]' internal/db/*.sql.go; then
  echo "a parameter or result column is missing its ::type cast or AS name"; exit 1
fi
sqlfluff lint internal/db/queries.sql

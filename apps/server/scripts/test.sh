#!/usr/bin/env bash
# Runs the Go tests against the database scripts/test-db.sh names.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/test-db.sh

if (($#)); then
  exec go test -race -count=1 -shuffle=on ./... "$@"
fi

# A full run also holds every generated query and every dynamic.go function to running in a test.
profile="$(mktemp)"
trap 'rm -f "$profile"' EXIT
go test -race -count=1 -shuffle=on -coverpkg=./internal/db -coverprofile="$profile" ./...
if go tool cover -func="$profile" | grep -E '(\.sql\.go|dynamic\.go):.*[[:space:]]0\.0%$'; then
  echo "no test runs these db functions"; exit 1
fi

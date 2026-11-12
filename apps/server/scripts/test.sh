#!/usr/bin/env bash
# Runs the Go tests against the database scripts/test-db.sh names.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/test-db.sh

exec go test ./... "$@"

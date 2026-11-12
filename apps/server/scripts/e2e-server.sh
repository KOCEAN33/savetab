#!/usr/bin/env bash
# Builds and runs cmd/savetab-e2e, the server the extension's e2e tests sync against, on the
# database scripts/test-db.sh names. The binary replaces this shell, so a signal reaches it.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/test-db.sh

bin="$(mktemp -d)/savetab-e2e"
go build -o "$bin" ./cmd/savetab-e2e
exec "$bin"

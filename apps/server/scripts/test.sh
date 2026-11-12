#!/usr/bin/env bash
# Runs the Go tests. Without TEST_DATABASE_URL it uses the homelab dev cluster as role `agent`
# acting as `savetab`, with the password read from 1Password through the keychain token.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${TEST_DATABASE_URL:-}" ]]; then
  token="$(security find-generic-password -s proxmox-talos-lab-op -w)"
  password="$(OP_SERVICE_ACCOUNT_TOKEN="$token" op read op://Homelab/agent-dev-db/password)"
  export TEST_DATABASE_URL="postgres://agent:${password}@pg-dev.lab.hiriri.com:5432/savetab?sslmode=require&options=-c%20role%3Dsavetab"
fi

exec go test ./... "$@"

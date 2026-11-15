#!/usr/bin/env bash
# Holds api/openapi.yaml and the code oapi-codegen generates from it to their gates.
set -euo pipefail
cd "$(dirname "$0")/.."

generated=internal/api/api.gen.go
before="$(shasum "$generated")"
go generate ./...
if [[ "$(shasum "$generated")" != "$before" ]]; then
  echo "$generated was not the output of go generate: commit the file as it is now"; exit 1
fi

pnpm exec spectral lint api/openapi.yaml --ruleset api/.spectral.yaml --fail-severity warn

# OPENAPI_BASE is the default branch's contract. CI checks that branch out to name it.
base="${OPENAPI_BASE:-}"
if [[ -z "$base" ]]; then
  base="$(mktemp)"
  trap 'rm -f "$base"' EXIT
  git show origin/main:apps/server/api/openapi.yaml >"$base"
fi
oasdiff breaking --fail-on ERR "$base" api/openapi.yaml

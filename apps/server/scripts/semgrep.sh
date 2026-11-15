#!/usr/bin/env bash
# Runs the repository Semgrep rules in _semgrep/: first their own tests, then the scan.
set -euo pipefail
cd "$(dirname "$0")/.."

# semgrep --test exits 0 when it finds no test file, so the count of tested rules is checked.
tested="$(semgrep --test --metrics=off --config _semgrep _semgrep 2>&1)" || { echo "$tested"; exit 1; }
echo "$tested"
rules="$(find _semgrep -name '*.yaml' | wc -l | tr -d ' ')"
grep -q "^$rules/$rules: " <<<"$tested" || { echo "want $rules rule files tested"; exit 1; }
semgrep scan --quiet --error --metrics=off --config _semgrep --exclude=_semgrep .

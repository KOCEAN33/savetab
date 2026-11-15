#!/usr/bin/env bash
# Runs the repository Semgrep rules in semgrep/: first their own tests, then the scan.
set -euo pipefail
cd "$(dirname "$0")/.."

semgrep --test --metrics=off --config semgrep semgrep
semgrep scan --quiet --error --metrics=off --config semgrep --exclude=semgrep .

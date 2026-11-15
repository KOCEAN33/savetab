#!/usr/bin/env bash
# Lints charts/savetab and holds its rendered Deployment to the policies in charts/savetab/policy.
set -euo pipefail
cd "$(dirname "$0")/../charts/savetab"

helm lint --strict . -f ci/lint-values.yaml
conftest verify -p policy
helm template savetab . -f ci/lint-values.yaml | conftest test -p policy -

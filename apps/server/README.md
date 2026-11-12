# savetab server

The sync server: Go and Postgres. Its contract is the `### P4: sync server` section of `docs/plans/onetab-parity.md`.

## Run

`DATABASE_URL` is required. `LISTEN_ADDR` defaults to `:8080`. The server applies its migrations at start.

```bash
DATABASE_URL=postgres://... go run ./cmd/savetab-server
```

## Test

Tests run against a real Postgres. Each run creates a database `savetab_test_<random>` on the server that `TEST_DATABASE_URL` names and drops it at the end, so the role needs `CREATEDB`.

`pnpm test` calls `scripts/test.sh`. Without `TEST_DATABASE_URL`, the script uses the homelab dev cluster `pg-dev.lab.hiriri.com` as role `agent` acting as `savetab`, which needs the tailnet and the `proxmox-talos-lab-op` keychain token. CI sets `TEST_DATABASE_URL` to its Postgres service container.

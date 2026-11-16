# savetab server

The sync server: Go and Postgres. Its HTTP contract is `api/openapi.yaml`, and its design is the `### P4: sync server` section of `docs/plans/onetab-parity.md`.

## Run

The server applies its migrations at start, and reads the issuer's discovery document, so the issuer must be reachable then. `internal/platform/config` loads every variable, and a bad start names every missing or malformed one at once. The issuer's client is public on PKCE, so the server takes no client secret.

| Variable | Value |
| --- | --- |
| `DATABASE_URL_FILE` | Path of a file that holds the Postgres URL. Required. |
| `LISTEN_ADDR` | Listen address, such as `:8080`. Required. |
| `OIDC_ISSUER` | Issuer URL of the OIDC provider. Required. |
| `OIDC_CLIENT_ID` | Client id registered at the issuer. Required. |
| `PUBLIC_URL` | The server's base URL as browsers reach it. Required. The issuer's redirect URI is `<PUBLIC_URL>/v2/authorizations/callback`. |
| `AUTH_REDIRECT_URIS` | Redirect URIs a login may end at, separated by one space. Required. Each extension's is the value of `browser.identity.getRedirectURL()`. |
| `DB_POOL_MAX` | Most connections the pool opens. Default `10`. |
| `DB_STATEMENT_TIMEOUT` | `statement_timeout` of every pool connection. Default `5s`. |
| `DB_IDLE_IN_TX_TIMEOUT` | `idle_in_transaction_session_timeout` of every pool connection. Default `10s`. |
| `START_WAIT` | How long the first database connection may take. Default `30s`. |
| `REQUEST_DEADLINE` | Deadline of one request. Default `10s`. Shorter than `HTTP_DRAIN_TIMEOUT`. |
| `READY_PING_TIMEOUT` | Timeout of the readiness database ping. Default `1s`. |
| `HTTP_DRAIN_TIMEOUT` | How long a stop waits for running requests. Default `15s`. Shorter than `SHUTDOWN_BUDGET`. |
| `SHUTDOWN_BUDGET` | The Pod's `terminationGracePeriodSeconds` minus its `preStop` sleep. Default `20s`. |
| `LOG_FORMAT` | `json`, one object per line, or `console`, colored text for a terminal. Default `json`. |
| `LOG_LEVEL` | Lowest level written: `debug`, `info`, `warn`, or `error`. Default `info`. |

```bash
DATABASE_URL_FILE=/path/to/url LISTEN_ADDR=:8080 OIDC_ISSUER=https://... go run ./cmd/savetab-server
```

## Test

Tests run against a real Postgres. Each run creates a database `savetab_test_<random>` on the server that `TEST_DATABASE_URL` names and drops it at the end, so the role needs `CREATEDB`.

`pnpm test` calls `scripts/test.sh`. Without `TEST_DATABASE_URL`, the script uses the homelab dev cluster `pg-dev.lab.hiriri.com` as role `agent` acting as `savetab`, which needs the tailnet and the `proxmox-talos-lab-op` keychain token. CI sets `TEST_DATABASE_URL` to its Postgres service container.

`pnpm check` runs `go vet`, then `golangci-lint` with `.golangci.yml`, so it needs golangci-lint v2 on the PATH (`brew install golangci-lint`). It then runs `scripts/check-sql.sh`, which needs sqlc and SQLFluff (`brew install sqlc`, `uv tool install sqlfluff`): `sqlc diff` fails when `internal/db/queries.sql` and the generated files disagree, so run `sqlc generate` after a query change. Last it runs Squawk with `.squawk.toml` on `internal/db/migrations/`, so it needs `squawk` on the PATH, a binary from the releases of `sbdchd/squawk`. A migration file after `0004` that holds DDL starts with `SET LOCAL lock_timeout` and `SET LOCAL statement_timeout`, the lock timeout the lower. The runner applies the pending files in one transaction, so `CREATE INDEX CONCURRENTLY` cannot run in one. Then it runs `scripts/check-api.sh` on the `/v2` contract `api/openapi.yaml`: `go generate` must leave `internal/api/api.gen.go` as it is, so run `go generate ./...` after a contract change. Spectral lints the contract with `api/.spectral.yaml`, and `oasdiff breaking` compares it with the contract on `origin/main`, so it needs `oasdiff` on the PATH (`brew install oasdiff`). CI installs the version `.github/workflows/ci.yml` pins.

## Server for the extension's e2e tests

`scripts/e2e-server.sh` builds and runs `cmd/savetab-e2e`: the API on a free local port, on a `savetab_test_<random>` database of its own, with an OIDC issuer it runs itself (`internal/platform/fakeoidc`) that logs every visitor in as one user. It prints its URL as the first line of stdout and drops the database on SIGTERM. `AUTH_REDIRECT_URIS` sets the redirect URIs a login may end at, which the script passes to the binary as arguments. It finds the database the way `scripts/test.sh` does, through `scripts/test-db.sh`.

## Deployment

The server runs on the homelab cluster at `https://savetab.lab.hiriri.com`, reachable on the tailnet only by the owner's decision. The cluster's rules are in the vault: `vault-memory get projects/homelab/gitops.md`.

- Image: `.github/workflows/image.yml` pushes `ghcr.io/kocean33/savetab:<full commit sha>` on a push to `main` that touches the server's sources. The package is public.
- Chart: `charts/savetab/` in this repository. It takes the database Secret by name and creates no Secret.
- Values and Secrets: `KOCEAN33/homelab-workloads`, `savetab/envs/` for the values and `savetab/manifests/prod/` for the database ExternalSecret. A deploy is a commit there that sets `image.tag` in `savetab/envs/prod.yaml` and `chartRevision` in `savetab/appset.yaml` to the same savetab commit. Argo CD syncs it as the Application `savetab-prod`.
- Database: role and database `savetab` on the production Postgres, declared in `KOCEAN33/homelab-platform` `manifest/postgres/`. The password is the 1Password item `savetab-db` in the vault `Homelab`. The server connects to `postgres-rw.postgres.svc`, not the pooler, because pgx's statement cache does not survive transaction pooling. No file sets `statement_timeout` or `idle_in_transaction_session_timeout` on the role: the server sets both as startup parameters of every connection, from `DB_STATEMENT_TIMEOUT` and `DB_IDLE_IN_TX_TIMEOUT` (`internal/db/store.go`).
- Login: Zitadel at `https://auth.hiriri.com`, project `savetab`, application `savetab`, a public client on PKCE with no client secret. The project admits only users who hold the role `savetab-user`.
- `AUTH_REDIRECT_URIS` in `savetab/envs/prod.yaml` holds the Firefox add-on's URI, the SHA-1 of `savetab@kocean33` under `extensions.allizom.org`, and the Chrome GitHub Releases build's `https://mjkkpkbgjflhjgdkhhnejpjcdkfcpmkb.chromiumapp.org/`, whose id the manifest `key` fixes (`apps/extension/wxt.config.ts`). A Chrome Web Store item has its own id and needs its URI added.
- Health: `GET /livez` answers 200 whenever a handler can run. `GET /readyz` answers 200 once the listener is open and a database ping succeeds within `READY_PING_TIMEOUT`, else 503. The chart's startup and liveness probes get `/livez` and its readiness probe `/readyz`. `scripts/check-chart.sh`, run by `pnpm check`, holds the rendered Deployment to the probe and stop rules in `charts/savetab/policy/`.
- Check: `curl -i https://savetab.lab.hiriri.com/readyz` answers 200.


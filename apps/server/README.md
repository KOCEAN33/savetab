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

Tests run against a real Postgres, the server that `TEST_DATABASE_URL` names. Each test gets a database of its own from pgtestdb (`internal/platform/testdb`): a clone of a template that the migrations filled, dropped when the test passes. The role needs `CREATEDB`. A failed test keeps its database and logs its URL.

`pnpm test` calls `scripts/test.sh`, which stops without `TEST_DATABASE_URL`. The variable names a Postgres the tests may fill, such as a local container, never a shared database. CI sets it to its Postgres service container.

```bash
docker run -d --name savetab-test-pg -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:5432:5432 postgres
export TEST_DATABASE_URL='postgres://postgres:postgres@127.0.0.1:5432/postgres?sslmode=disable'
```

`pnpm check` runs `go vet`, then `golangci-lint` with `.golangci.yml`, so it needs golangci-lint v2 on the PATH (`brew install golangci-lint`). It then runs `scripts/check-sql.sh`, which needs sqlc and SQLFluff (`brew install sqlc`, `uv tool install sqlfluff`): `sqlc diff` fails when `internal/db/queries.sql` and the generated files disagree, so run `sqlc generate` after a query change. Last it runs Squawk with `.squawk.toml` on `internal/db/migrations/`, so it needs `squawk` on the PATH, a binary from the releases of `sbdchd/squawk`. A migration file after `0004` that holds DDL starts with `SET LOCAL lock_timeout` and `SET LOCAL statement_timeout`, the lock timeout the lower. The runner applies the pending files in one transaction, so `CREATE INDEX CONCURRENTLY` cannot run in one. Then it runs `scripts/check-api.sh` on the `/v2` contract `api/openapi.yaml`: `go generate` must leave `internal/api/api.gen.go` as it is, so run `go generate ./...` after a contract change. Spectral lints the contract with `api/.spectral.yaml`, and `oasdiff breaking` compares it with the contract on `origin/main`, so it needs `oasdiff` on the PATH (`brew install oasdiff`). CI installs the version `.github/workflows/ci.yml` pins.

## Server for the extension's e2e tests

`scripts/e2e-server.sh` builds and runs `cmd/savetab-e2e`: the API on a free local port, on a test database of its own, with an OIDC issuer it runs itself (`internal/platform/fakeoidc`) that logs every visitor in as one user. It prints its URL as the first line of stdout and drops the database on SIGTERM. `AUTH_REDIRECT_URIS` sets the redirect URIs a login may end at, which the script passes to the binary as arguments. It needs `TEST_DATABASE_URL`, as `scripts/test.sh` does.

## Layout

`internal/bus/ops.go` and `internal/db/ops.go` are the pattern files of a use case and its queries.

- sqlc generates `Queries` from `internal/db/queries.sql` per `apps/server/sqlc.yaml`: `db.New(tx)` inside a transaction, `store.Queries()` outside one. After a query change, run `sqlc generate` in `apps/server`. An id is a `uuid.UUID` from `db` through `bus`, and the generated `api` code parses it.
- Generated code returns the driver error as it is. `internal/db/mapped.go` sits under every `Queries` and maps it to a kind: `store.Queries()` and the `pgx.Tx` an `InTx` closure gets both run on it. A `Queries` built on a raw pool or transaction returns unmapped errors.
- `internal/db/dynamic.go` holds the SQL sqlc cannot compile: the pairing message update, whose column varies, and the migration runner's statements. Its functions take a `DBTX` and call `MapError` themselves.
- A `bus` use case opens the transaction with `store.InTx(ctx, fn)`, or `store.InSnapshot` for reads that must agree, holds the rule, and sets the kind of a broken rule with `errs.New`. `bus` declares the types `api` uses and holds token making, hashing, and every lifetime. `api.NewHandlers` takes a `*bus.Bus`.
- `internal/api` holds `/v2`. `api.gen.go` is the oapi-codegen output: after a contract change, run `go generate ./...` in `apps/server`. `handlers.go` holds `Handlers`, the token check, and the page token, and each entity file holds its operations. A handler returns a use case error as it is, and `httpserver.Problem` writes it.
- The `/v2` tests in `internal/api` were written from the contract by an author who had not read the handlers. Each test calls `newServer(t)` of `main_test.go`: the whole server from `wire.NewServer` on a database of its own, with its own issuer. The helpers of `spec_test.go` take that server and hold every response to the contract. `wantQueryCount` holds a list endpoint to its SQL statement count, read from the request's line by trace id. A test writes a state the endpoints cannot produce with SQL over pgx, per step 3.
- A snapshot replaces the stored one only at a higher seq.
- `testdb.New(t, db.MigrationsHash, db.MigrateURL)` gives a test its migrated database. Every test calls `t.Parallel()` and sits in a `_test` package, held by `paralleltest` and `testpackage`. The scripts stop without `TEST_DATABASE_URL`, so a local run needs the Postgres container of `apps/server/README.md`.
- `httpserver.Server.ServeUntil` holds the drain at stop, and `wire.run` calls it.
- `internal/platform/config` loads every variable. `cmd/savetab-server` calls `wire.Main`, which loads the configuration and calls `wire.Run`. `wire.Run` (`internal/wire/wire.go`) uses every config field. The shutdown budget goes only to the start line, since the chart's grace period and the config validation are what act on it.
- `httpserver.New` (`internal/httpserver/server.go`) builds the `http.Server` on a gin engine with the request line middleware first, then the request deadline middleware. It serves `/livez` and `/readyz`, takes the API's routes from its `register` argument, and answers CORS preflights and the 404 and 405 problems. Its `Serve` marks the listener open for `/readyz`. `httpserver.Problem` writes an error as the problem of its kind through `httpserver.Status`, and `httpserver.BodyLimit` is the size cap. `wire.NewServer` registers the generated routes with the token check, the size cap, and the validator, in that order.
- `db.Open` takes `db.Options` and sets `statement_timeout` and `idle_in_transaction_session_timeout` on every pool connection, since no file sets them on the role.
- `pnpm check` needs golangci-lint v2, sqlc, sqlfluff, squawk, helm, and conftest on the PATH. `apps/server/scripts/check-sql.sh` runs `sqlc diff`, the parameter and type greps, SQLFluff, and Squawk with `apps/server/.squawk.toml` on the migrations after `0004`. `apps/server/scripts/test.sh` fails a full run when a generated query or a `dynamic.go` function runs in no test. `apps/server/scripts/check-api.sh` needs oasdiff on the PATH: it reruns `go generate`, lints the contract with Spectral and `apps/server/api/.spectral.yaml`, whose `response-is-object` rule holds JSON bodies only since the viewer answers HTML, and runs `oasdiff breaking` against the contract on `origin/main`. `scripts/check-chart.sh` lints `charts/savetab/` with the stand-in values of `charts/savetab/ci/lint-values.yaml` and runs the Conftest policies of `charts/savetab/policy/` on its render.
- `pnpm lint` needs semgrep on the PATH. `apps/server/scripts/semgrep.sh` tests then runs the rules in `apps/server/_semgrep/`, a name the Go tools and the archtest skip, one rule file with a test file of the same name each.
- `internal/platform/logline` holds every log key. A request writes one line, from `requestLine` in `internal/httpserver/requestline.go`. Code under a request adds to that line through the context: `logline.SetError`, `SetUser`, and the pgx tracer in `internal/db/tracer.go`. `wire.Run` builds the one logger and writes the start and stop lines. The Semgrep rules `log-through-logline` and `log-an-error-or-return-it` hold this.
- `internal/archtest` and the depguard rules in `apps/server/.golangci.yml` hold the layout. `internal/wire/routes_test.go` holds the routes to the spec, with only the probes outside it.
- The image takes its version and commit from the `VERSION` and `COMMIT` build arguments, which the release workflow sets. A local build logs `dev` and `unknown`.

How the extension reads `/v2`:

- `apps/extension/lib/sync.ts` holds the wire boundary: `client` sends a call, `requestTokens` trades a grant at `POST /v2/tokens`, and `listAll` follows `next_page_token`. A caller tells failures apart by status: 409 on `GET /v2/ops` means read the snapshot first, 409 on `PUT /v2/snapshot` means another device's snapshot covers the ops, and 404 on `GET /v2/key` means no key yet. `SyncError.type` carries the problem's `type`.
- The wire is snake_case with RFC 3339 times. `SyncAccount`, `Pairing`, `Device`, and a stored share stay camelCase with epoch milliseconds, converted where the response is read.
- `requestPairing` and `shareItem` make the `id` that `POST /v2/pairings` and `POST /v2/shares` take.
- A share's URL is `<server>/v2/shares/<id>/view#<key>`. The viewer is the operation `viewShare`: `internal/api/viewer.go` puts `viewer/share.css` and `viewer/share.js` inline in `viewer/share.html` and admits them by hash in the policy.

## Deployment

The server runs on the homelab cluster at `https://savetab.lab.hiriri.com`, reachable on the tailnet only by the owner's decision. The cluster's rules are in the vault: `vault-memory get projects/homelab/gitops.md`.

- Image: the `image` job of `.github/workflows/release.yml` pushes `ghcr.io/kocean33/savetab:<version>` for each release, under that one tag (`docs/guides/release.md`). The binary logs the version and the release commit at start. The package is public.
- Chart: `charts/savetab/` in this repository. It takes the database Secret by name and creates no Secret.
- Values and Secrets: `KOCEAN33/homelab-workloads`, `savetab/envs/` for the values and `savetab/manifests/prod/` for the database ExternalSecret. A deploy is a commit there that sets `image.tag` in `savetab/envs/prod.yaml` to a version and `chartRevision` in `savetab/appset.yaml` to that version's tag `v<version>`. The `deploy` job of `.github/workflows/release.yml` makes that commit for each release, as the `kocean33-homelab-ci` GitHub App: the repository variable `HOMELAB_APP_CLIENT_ID` and the secret `HOMELAB_APP_PRIVATE_KEY` hold its credentials. Argo CD syncs it as the Application `savetab-prod`.
- Database: role and database `savetab` on the production Postgres, declared in `KOCEAN33/homelab-platform` `manifest/postgres/`. The password is the 1Password item `savetab-db` in the vault `Homelab`. The server connects to `postgres-rw.postgres.svc`, not the pooler, because pgx's statement cache does not survive transaction pooling. No file sets `statement_timeout` or `idle_in_transaction_session_timeout` on the role: the server sets both as startup parameters of every connection, from `DB_STATEMENT_TIMEOUT` and `DB_IDLE_IN_TX_TIMEOUT` (`internal/db/store.go`).
- Login: Zitadel at `https://auth.hiriri.com`, project `savetab`, application `savetab`, a public client on PKCE with no client secret. The project admits only users who hold the role `savetab-user`.
- `AUTH_REDIRECT_URIS` in `savetab/envs/prod.yaml` holds the Firefox add-on's URI, the SHA-1 of `savetab@kocean33` under `extensions.allizom.org`, and the Chrome GitHub Releases build's `https://mjkkpkbgjflhjgdkhhnejpjcdkfcpmkb.chromiumapp.org/`, whose id the manifest `key` fixes (`apps/extension/wxt.config.ts`). A Chrome Web Store item has its own id and needs its URI added.
- Health: `GET /livez` answers 200 whenever a handler can run. `GET /readyz` answers 200 once the listener is open and a database ping succeeds within `READY_PING_TIMEOUT`, else 503. The chart's startup and liveness probes get `/livez` and its readiness probe `/readyz`. `scripts/check-chart.sh`, run by `pnpm check`, holds the rendered Deployment to the probe and stop rules in `charts/savetab/policy/`.
- Check: `curl -i https://savetab.lab.hiriri.com/readyz` answers 200.


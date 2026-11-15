# Plan: bring the sync server to the backend practices

Goal: `apps/server` meets the vault pages under `practices/backend/` and `practices/backend/go/`. Read a page with `vault-memory get <page>` before the step that cites it. The practice page rules on any point this plan leaves open. Where neither rules, ask the owner.

## Decisions

- The HTTP contract moves to `/v2` in the practice's form: snake_case fields, `application/problem+json` errors, noun paths. `/v1` keeps serving until the extension has moved, then goes.
- The server and the extension share one version. Every push to `main` runs python-semantic-release, which makes the tag `v<version>`, stamps `apps/extension/package.json`, publishes the extension assets, and pushes the image under that version.
- The server keeps migrating at start, with its migrations embedded in the binary, so they stay under `internal/db/migrations/`. The layout page puts them in `db/migrations/` at the module root, which `go:embed` cannot reach from `internal/db`.
- The server is in the small form: one package per layer.
- `cmd/savetab-e2e` stays as a second main package: a thin caller that prepares the test database and the fake issuer, then calls `wire.Run`. The archtest allow-list names it.
- `GET /v2/ops` keeps `after` as its cursor in place of `page_token`, since the device stores that seq. A repeated op id in `POST /v2/ops` is skipped, not answered 409, so a retried push succeeds. Both are recorded exceptions to the practice rules.
- `POST /v2/tokens` takes no separate idempotency key: the login code and the refresh token are each spent by one attempt and serve as the key. A spent code answers 400 and a spent refresh token 401, not 409. An `Idempotency-Key` record would store the token pair in the clear, which the database otherwise holds only hashed. A recorded exception.
- A `/v2` time is an RFC 3339 string, where `/v1` sends epoch milliseconds.
- `POST /v2/pairings` and `POST /v2/shares` take a client `id` as their idempotency key. `GET /v2/devices` and `GET /v2/pairings` page by `page_size` and `page_token`, and `GET /v2/ops` takes `page_size` in place of `limit`.
- The `/v2` paths are the ones step 17 lists.
- The server takes no OIDC client secret: the Zitadel application is a public client on PKCE.

## Waiting on the owner

- The chart is `charts/savetab/` in this repository, and steps 11 and 19 change it in their own commit. The values and the database ExternalSecret stay in `KOCEAN33/homelab-workloads`, where a deploy is one commit that moves `chartRevision` and `image.tag` together, as savetube's does. The deploy is the owner's.

## Target tree

```
apps/server/
  cmd/savetab-server/main.go     calls wire.Run and nothing else
  api/openapi.yaml               the /v2 contract
  sqlc.yaml  .golangci.yml  releaserc.toml (repo root)
  internal/
    wire/        composition root: Run(ctx, config, options)
    httpserver/  gin engine, middleware, kind-to-status function, /livez, /readyz
    api/         oapi-codegen output and the strict handlers, one file per entity
    bus/         use cases and rules, one file per entity: ops, key, snapshot, pairing, login, session, device, share
    db/          queries.sql, sqlc output, dynamic.go, mapped.go, tx.go, dberr.go, migrate.go, migrations/
    platform/    errs, config, logline, testdb, fakeoidc
    archtest/
```

## Steps

Each step is one commit that leaves `pnpm test`, `pnpm check`, and `pnpm lint` green. A step that touches what the extension calls also passes `pnpm test:e2e` and `pnpm test:e2e:firefox`. Through step 13 the 39 handler tests in `internal/api/*_test.go` pin the `/v1` behavior: a step changes none of their assertions unless it says so. New tests follow the `writing-tests` skill, and the code follows `coding-deep`.

### Phase 1: architecture

1. **Test flags.** `scripts/test.sh` runs `go test -race -count=1 -shuffle=on ./...`. Done when `pnpm --filter @savetab/server test` passes with no `(cached)` line.
2. **Linter home.** Add `apps/server/.golangci.yml` with `default: none` and `errorlint`. `pnpm --filter @savetab/server check` runs `go vet ./...` then `golangci-lint run ./...`, and CI installs golangci-lint through its action pinned to a commit SHA. Done when the check passes locally and in CI.
3. **Test-only exports go.** Remove `CreateUser`, `CreateDevice`, and `IssueSession` from `store`. The test helper makes a user and a device through the login endpoints against `fakeoidc`. A state the endpoints cannot produce, such as an expired session, is written by SQL in the test helper.
4. **Move Package.** `internal/store` becomes `internal/db`, `internal/testdb` becomes `internal/platform/testdb`, `internal/fakeoidc` becomes `internal/platform/fakeoidc`. No other change.
5. **Error kinds.** Add `internal/platform/errs` with the nine kinds of `practices/backend/error-handling.md`. Add `internal/db/dberr.go`, the one function that maps a driver error to a kind, with the table test that page names. Every `db` function returns a kinded error in place of its sentinel: no session is `Unauthenticated`, a missing row `NotFound`, an existing key, a stale snapshot, a required snapshot, and a pairing message out of order `Conflict`, a snapshot ahead of the log `Invalid`, a pairing message from the wrong side `Forbidden`. The `/v1` handlers read the kind and answer the same status and code as before.
6. **Transaction function.** Extract Function: `db.InTx` in `internal/db/tx.go` wraps `pgx.BeginTxFunc`. The eight call sites use it.
7. **Transaction retry.** `db.InTx` reruns the closure on `40001` and `40P01` up to a constant attempt count, with the test `practices/backend/go/sqlc-pgx.md` names. This step changes behavior and nothing else.
8. **Extract the use cases.** Add `internal/bus`. One commit per entity, in this order: ops, key and snapshot, pairing, login and session and device, share. A use case opens the transaction and holds the rule. The `db` function keeps SQL and row conversion. What moves: the duplicate-id filter of a push, the snapshot seq check, the pairing order and side checks, the login code challenge compare, token making and hashing, and the token and pairing and share lifetimes. `internal/api` imports `bus` and `platform` only. Done when no file in `internal/api` imports `internal/db` or pgx.
9. **Config.** Add `internal/platform/config`: one struct and one loader on `caarlos0/env`, per `practices/backend/go/configuration.md`, with its two loader tests and the secret redaction test. The database URL becomes the secret `DATABASE_URL_FILE`. `OIDC_CLIENT_SECRET`, `LoginConfig.ClientSecret`, and the fake issuer's secret check go. `cmd/savetab-e2e` takes its redirect URIs as arguments, which `scripts/e2e-server.sh` passes from `AUTH_REDIRECT_URIS`. `LISTEN_ADDR` loses its default. The start wait, request deadline, readiness ping timeout, HTTP drain timeout, shutdown budget, and pool maximum become fields. Add `forbidigo` for environment reads, excluding the test database helper. The commit is `feat(config)!:`, and `apps/server/README.md` lists the new variables. Chart change: mount the database Secret as a directory, as `printer-gateway` mounts its tokens, point `DATABASE_URL_FILE` at its `url` file, and set `LISTEN_ADDR`.
10. **HTTP server package.** Add `internal/httpserver`: a `gin.New()` engine, the kind-to-status function with its table test, the request deadline middleware, and the `http.Server` with `ReadHeaderTimeout` and `IdleTimeout`. The `/v1` mux, `/s/`, and `/healthz` mount on the engine through `gin.WrapH`, unchanged.
11. **Lifecycle.** `/livez` and `/readyz` per `practices/backend/service-lifecycle.md`, with its gate tests. `/healthz` stays until step 17. Chart change: probes on the new paths, `preStop` sleep, grace period.
12. **Composition root.** Add `internal/wire` with `Run`, which owns start order and the shutdown sequence of `practices/backend/go/service-lifecycle.md`, with the slow-request shutdown test. `cmd/savetab-server/main.go` calls it and exits 1 on its error. `cmd/savetab-e2e` prepares the test database and the fake issuer, then calls the same `Run` with a listener on a free port. Add the Semgrep rule against `ListenAndServe`.
13. **Canonical log line.** Add `internal/platform/logline`: the field set on the context, the key constants, and the attribute builders. One middleware, registered first, writes the request line from a `defer` that also recovers a panic. The handler is `slog.NewJSONHandler` on stdout, or `tint` by a config value. `version` and `commit` are link-time variables set on the root logger. The process writes a start line with the effective config and a stop line with the reason. A pgx tracer fills `db.query_count` and `db.duration_ms`. A `/v1` handler sets `http.route` from `r.Pattern`. The eight existing `slog` calls go: an error is a field on the line. Tests: every gate of `practices/backend/logging-design.md`. Add the Semgrep rules on literal log keys and on log-then-return.
14. **Architecture gates.** Add `internal/archtest` and the depguard rules of `practices/backend/go/project-layout.md`, module path `github.com/KOCEAN33/savetab/apps/server`. The allow-list names `cmd/savetab-e2e` as the second main package. The `api` rule and the Database calls check allow the `/v1` files by name until step 17. Done when `go test ./internal/archtest` and `golangci-lint run` pass.

### Phase 2: data access

15. **sqlc.** Add `sqlc.yaml` and `internal/db/queries.sql` per `practices/backend/go/sqlc-pgx.md`. One commit per entity file replaces its hand-written SQL with generated queries. The pairing message update, whose column varies, moves to `dynamic.go` and quotes the column with `pgx.Identifier`. `RETURNING *` becomes a column list. CI runs `sqlc diff`, the `$[0-9]` and `pgtype` greps, and SQLFluff `AM04` and `AM09`. Done when the archtest Database calls and Transaction calls checks pass with no allowed file under `internal/db`.
16. **Migration and role timeouts.** A new migration file sets nothing in old files. Each later DDL migration sets `lock_timeout` and `statement_timeout`, enforced by Squawk in CI from that file on. `apps/server/README.md` names where the `savetab` role's `statement_timeout` and `idle_in_transaction_session_timeout` are set.

### Phase 3: the /v2 contract

17. **/v2, as parallel change.** Three releases.
    - Add: write `api/openapi.yaml`, generate the gin strict server with oapi-codegen, and write the handlers in `internal/api` over the same use cases. Add the validation and size-cap middleware, the 404, 405, and 413 problems, the route-against-spec test, response validation in handler tests, Spectral, and `oasdiff`. The handler tests are written from the spec by an author who has not read the handlers.
    - Move: `apps/extension/lib/sync.ts`, `account.ts`, `share.ts`, `apps/server/internal/api/viewer/share.js`, and the e2e helpers `e2e/sync-server.ts` and `e2e-firefox/sync-fixtures.ts` call `/v2`.
    - Remove: the `/v1` handlers, their tests, `/healthz`, and the allow-list entries of step 14, once the deployed chart probes `/readyz`. `docs/plans/onetab-parity.md` `### P4` points at `api/openapi.yaml` for the contract.

    Paths: `GET /v2/authorizations` and `GET /v2/authorizations/callback` for the login redirect pair, `POST /v2/tokens` with `grant_type` `authorization_code` or `refresh_token`, and the other resources under their `/v1` names. A snapshot ahead of the log answers 400, a stale one 409, so the client tells them apart by status.

    Recorded exceptions to the practice rules: `GET /v2/ops` keeps `after` as its cursor, a repeated op id in `POST /v2/ops` is skipped, and `POST /v2/tokens` takes its code or refresh token as its idempotency key. The Decisions section gives the reasons.

### Phase 4: tests and release

18. **Test isolation.** A database per test from pgtestdb, `t.Parallel()` in every test with `paralleltest`, `testpackage`, and a statement-count assertion in each list endpoint's test. `scripts/test-db.sh` stops naming the shared dev cluster: a missing `TEST_DATABASE_URL` fails with the variable's name.
19. **Release.** Add `releaserc.toml` with the keys of `practices/backend/release-versioning.md`, plus `version_variables` for `apps/extension/package.json`. Check the stamp with `semantic-release --noop version --print` before relying on it. One workflow on push to `main`, with a `concurrency` group, runs the CI checks, the release, then, only when `released` is true, `scripts/package-release.mjs` and the image build tagged with the `version` output through `type=semver`. The image build passes version and commit as link-time variables. `release.yml`'s tag trigger and `image.yml`'s SHA tag go. Add commitlint with the ten types, hadolint, `docker build --check`, and gitleaks to CI. Rewrite `docs/guides/release.md` "Cut a release" and the image line of `apps/server/README.md`. Chart change: `image.tag` holds a version, and the deploy commit sets `chartRevision` to the matching `v<version>` tag.

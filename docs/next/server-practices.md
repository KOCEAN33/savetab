# Next

## Goal

`apps/server` meets the owner's backend practice pages: every step of `docs/plans/server-practices.md` is committed with its checks green.

## Start

The Move release of step 17 of `docs/plans/server-practices.md`, since every later step follows the plan's order. Steps 1 to 16 and the Add release are committed: the server serves `/v2` as `apps/server/api/openapi.yaml` declares it, beside `/v1`. Move, in the plan's words: `apps/extension/lib/sync.ts`, `account.ts`, `share.ts`, `apps/server/internal/api/viewer/share.js`, and the e2e helpers `e2e/sync-server.ts` and `e2e-firefox/sync-fixtures.ts` call `/v2`.

What `/v2` changes for a caller, beyond the paths and snake_case:

- An error is a problem. The client reads the status and `type`, where `/v1` sent `{"error": code}`. A snapshot ahead of the log is 400 and a stale one 409. A 409 on `GET /v2/ops` means read the snapshot first.
- `POST /v2/pairings` and `POST /v2/shares` take a client `id`. `GET /v2/devices` and `GET /v2/pairings` page by `page_size` and `next_page_token`. A time is an RFC 3339 string.
- A login starts at `GET /v2/authorizations`, and the issuer redirects to `<PUBLIC_URL>/v2/authorizations/callback`. The Zitadel application needs that redirect URI before a deploy of the Move release, which is the owner's.

Open questions for the owner, none of which blocks Move:

- The share viewer `/s/{id}` is HTML outside `/v<N>` and outside the spec. Where it lives after the Remove release is open in the plan and the practice pages. The route test allows it by name.
- The contract states the 1024-byte bound of a key and a pairing message, and the 32-byte commitment, in prose. The schema bounds only the base64 text, so the handlers hold the byte bounds.
- The contract names 404, 405, 413, 499, 500, and 503 for every operation in prose, not as a response of each operation.
- The contract is silent on: an unknown refresh token or login code as against a spent one, which failure wins when a request has no token and a bad body, and whether "the same caller" of a page token is the user or the device. The server answers an unknown one as a spent one, checks the token first, and binds a page token to the user.

The layers the remaining steps build on, with `internal/bus/ops.go` and `internal/db/ops.go` as the pattern files:

- sqlc generates `Queries` from `internal/db/queries.sql` per `apps/server/sqlc.yaml`: `db.New(tx)` inside a transaction, `store.Queries()` outside one. After a query change, run `sqlc generate` in `apps/server`. An id is a `uuid.UUID` from `db` through `bus`, and `api` parses it with `parseID`.
- Generated code returns the driver error as it is. `internal/db/mapped.go` sits under every `Queries` and maps it to a kind: `store.Queries()` and the `pgx.Tx` an `InTx` closure gets both run on it. A `Queries` built on a raw pool or transaction returns unmapped errors.
- `internal/db/dynamic.go` holds the SQL sqlc cannot compile: the pairing message update, whose column varies, and the migration runner's statements. Its functions take a `DBTX` and call `MapError` themselves.
- A `bus` use case opens the transaction with `store.InTx(ctx, fn)`, or `store.InSnapshot` for reads that must agree, holds the rule, and sets the kind of a broken rule with `errs.New`. `bus` declares the types `api` uses and holds token making, hashing, and every lifetime. `api.New` takes a `*bus.Bus`.
- `internal/api` holds both versions. The `v1*.go` files are `/v1` and its 39 tests, and the Remove release deletes them. `api.gen.go` is the oapi-codegen output: after a contract change, run `go generate ./...` in `apps/server`. `handlers.go` holds `Handlers`, the token check, and the page token, and each entity file holds its operations. A handler returns a use case error as it is, and `httpserver.Problem` writes it.
- The `/v2` tests in `internal/api` were written from the contract by an author who had not read the handlers. They share `main_test.go`, whose `srv` is the whole server from `wire.NewServer`, and the helpers of `spec_test.go`, which hold every response to the contract. A test writes a state the endpoints cannot produce with SQL over pgx, per step 3.
- A snapshot replaces the stored one only at a higher seq, on `/v1` as on `/v2`.
- `internal/platform/config` loads every variable. `cmd/savetab-server` calls `wire.Main`, which loads the configuration and calls `wire.Run`. `wire.Run` (`internal/wire/wire.go`) uses every config field. The shutdown budget goes only to the start line, since the chart's grace period and the config validation are what act on it.
- `httpserver.New` (`internal/httpserver/server.go`) builds the `http.Server` on a gin engine with the request line middleware first, then the request deadline middleware. It mounts the `api.New` handler on `/v1`, `/s/`, and `/healthz` through `gin.WrapH`, serves `/livez` and `/readyz`, and answers CORS preflights and the 404 and 405 problems. Its `Serve` marks the listener open for `/readyz`. `httpserver.Problem` writes an error as the problem of its kind through `httpserver.Status`, and `httpserver.BodyLimit` is the size cap. `wire.NewServer` registers the generated routes with the token check, the size cap, and the validator, in that order.
- `db.Open` takes `db.Options` and sets `statement_timeout` and `idle_in_transaction_session_timeout` on every pool connection, since no file sets them on the role.
- `pnpm check` needs golangci-lint v2, sqlc, sqlfluff, squawk, helm, and conftest on the PATH. `apps/server/scripts/check-sql.sh` runs `sqlc diff`, the parameter and type greps, SQLFluff, and Squawk with `apps/server/.squawk.toml` on the migrations after `0004`. `apps/server/scripts/test.sh` fails a full run when a generated query or a `dynamic.go` function runs in no test. `apps/server/scripts/check-api.sh` needs oasdiff on the PATH: it reruns `go generate`, lints the contract with Spectral and `apps/server/api/.spectral.yaml`, and runs `oasdiff breaking` against the contract on `origin/main`. `scripts/check-chart.sh` lints `charts/savetab/` with the stand-in values of `charts/savetab/ci/lint-values.yaml` and runs the Conftest policies of `charts/savetab/policy/` on its render.
- `pnpm lint` needs semgrep on the PATH. `apps/server/scripts/semgrep.sh` tests then runs the rules in `apps/server/_semgrep/`, a name the Go tools and the archtest skip, one rule file with a test file of the same name each.
- `internal/platform/logline` holds every log key. A request writes one line, from `requestLine` in `internal/httpserver/requestline.go`. Code under a request adds to that line through the context: `logline.SetError`, `SetUser`, `SetRoute`, and the pgx tracer in `internal/db/tracer.go`. `wire.Run` builds the one logger and writes the start and stop lines. The Semgrep rules `log-through-logline` and `log-an-error-or-return-it` hold this.
- `internal/archtest` and the depguard rules in `apps/server/.golangci.yml` hold the layout. The allow-list at the top of `archtest_test.go` names what a later step removes: `internal/platform/testdb/testdb.go` at step 18. No `/v1` file needs an entry. `internal/wire/routes_test.go` holds the routes to the spec, with the `/v1` mounts on its allow-list until Remove.
- The image takes its commit from the `COMMIT` build argument, and `version` stays `dev` until step 19 sets `VERSION`.

Orders from the owner that bind later steps:

- Every finding of the review gets fixed, architecture phase first, in the plan's step order.
- The steps run one after another without a pause for approval. Work stops only for a choice only the owner can make, and a session that runs short of context moves to a new one by itself.
- The image tag stays the commit SHA until step 19 moves it to the version. Step 19 is not pulled forward.
- `/v2` takes the practice's form, and `/v1` goes once the extension has moved. The owner's rulings on the contract are in the plan's Decisions section.
- A point the plan and the practice pages both leave open is asked of the owner, never settled in the spec.
- The server and the extension share one version and one `v<version>` tag per merge.
- The chart is `charts/savetab/` in this repository. Steps 11 and 19 change it in their own commit. A deploy moves `chartRevision` and `image.tag` together in `KOCEAN33/homelab-workloads` and is the owner's.

## Next steps

The Move and Remove releases of step 17, then steps 18 and 19 of the plan, in order, each with the done-when the plan gives.

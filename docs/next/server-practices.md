# Next

## Goal

`apps/server` meets the owner's backend practice pages: every step of `docs/plans/server-practices.md` is committed with its checks green.

## Start

Step 18 of `docs/plans/server-practices.md`, test isolation, since every later step follows the plan's order. Steps 1 to 17 are committed: the server serves only `/v2`, as `apps/server/api/openapi.yaml` declares it, plus the probes `/livez` and `/readyz`.

The deploy of this server and the Zitadel cleanup wait on the owner: `docs/candidates.md`.

How the extension reads `/v2`:

- `apps/extension/lib/sync.ts` holds the wire boundary: `client` sends a call, `requestTokens` trades a grant at `POST /v2/tokens`, and `listAll` follows `next_page_token`. A caller tells failures apart by status: 409 on `GET /v2/ops` means read the snapshot first, 409 on `PUT /v2/snapshot` means another device's snapshot covers the ops, and 404 on `GET /v2/key` means no key yet. `SyncError.type` carries the problem's `type`.
- The wire is snake_case with RFC 3339 times. `SyncAccount`, `Pairing`, `Device`, and a stored share stay camelCase with epoch milliseconds, converted where the response is read.
- `requestPairing` and `shareItem` make the `id` that `POST /v2/pairings` and `POST /v2/shares` take.
- A share's URL is `<server>/v2/shares/<id>/view#<key>`. The viewer is the operation `viewShare`: `internal/api/viewer.go` puts `viewer/share.css` and `viewer/share.js` inline in `viewer/share.html` and admits them by hash in the policy.

Open questions for the owner about the contract, none of which blocks a step:

- The contract states the 1024-byte bound of a key and a pairing message, and the 32-byte commitment, in prose. The schema bounds only the base64 text, so the handlers hold the byte bounds.
- The contract names 404, 405, 413, 499, 500, and 503 for every operation in prose, not as a response of each operation.
- The contract is silent on: an unknown refresh token or login code as against a spent one, which failure wins when a request has no token and a bad body, and whether "the same caller" of a page token is the user or the device. The server answers an unknown one as a spent one, checks the token first, and binds a page token to the user.

The layers the remaining steps build on, with `internal/bus/ops.go` and `internal/db/ops.go` as the pattern files:

- sqlc generates `Queries` from `internal/db/queries.sql` per `apps/server/sqlc.yaml`: `db.New(tx)` inside a transaction, `store.Queries()` outside one. After a query change, run `sqlc generate` in `apps/server`. An id is a `uuid.UUID` from `db` through `bus`, and the generated `api` code parses it.
- Generated code returns the driver error as it is. `internal/db/mapped.go` sits under every `Queries` and maps it to a kind: `store.Queries()` and the `pgx.Tx` an `InTx` closure gets both run on it. A `Queries` built on a raw pool or transaction returns unmapped errors.
- `internal/db/dynamic.go` holds the SQL sqlc cannot compile: the pairing message update, whose column varies, and the migration runner's statements. Its functions take a `DBTX` and call `MapError` themselves.
- A `bus` use case opens the transaction with `store.InTx(ctx, fn)`, or `store.InSnapshot` for reads that must agree, holds the rule, and sets the kind of a broken rule with `errs.New`. `bus` declares the types `api` uses and holds token making, hashing, and every lifetime. `api.NewHandlers` takes a `*bus.Bus`.
- `internal/api` holds `/v2`. `api.gen.go` is the oapi-codegen output: after a contract change, run `go generate ./...` in `apps/server`. `handlers.go` holds `Handlers`, the token check, and the page token, and each entity file holds its operations. A handler returns a use case error as it is, and `httpserver.Problem` writes it.
- The `/v2` tests in `internal/api` were written from the contract by an author who had not read the handlers. They share `main_test.go`, whose `srv` is the whole server from `wire.NewServer`, and the helpers of `spec_test.go`, which hold every response to the contract. A test writes a state the endpoints cannot produce with SQL over pgx, per step 3.
- A snapshot replaces the stored one only at a higher seq.
- `internal/platform/config` loads every variable. `cmd/savetab-server` calls `wire.Main`, which loads the configuration and calls `wire.Run`. `wire.Run` (`internal/wire/wire.go`) uses every config field. The shutdown budget goes only to the start line, since the chart's grace period and the config validation are what act on it.
- `httpserver.New` (`internal/httpserver/server.go`) builds the `http.Server` on a gin engine with the request line middleware first, then the request deadline middleware. It serves `/livez` and `/readyz`, takes the API's routes from its `register` argument, and answers CORS preflights and the 404 and 405 problems. Its `Serve` marks the listener open for `/readyz`. `httpserver.Problem` writes an error as the problem of its kind through `httpserver.Status`, and `httpserver.BodyLimit` is the size cap. `wire.NewServer` registers the generated routes with the token check, the size cap, and the validator, in that order.
- `db.Open` takes `db.Options` and sets `statement_timeout` and `idle_in_transaction_session_timeout` on every pool connection, since no file sets them on the role.
- `pnpm check` needs golangci-lint v2, sqlc, sqlfluff, squawk, helm, and conftest on the PATH. `apps/server/scripts/check-sql.sh` runs `sqlc diff`, the parameter and type greps, SQLFluff, and Squawk with `apps/server/.squawk.toml` on the migrations after `0004`. `apps/server/scripts/test.sh` fails a full run when a generated query or a `dynamic.go` function runs in no test. `apps/server/scripts/check-api.sh` needs oasdiff on the PATH: it reruns `go generate`, lints the contract with Spectral and `apps/server/api/.spectral.yaml`, whose `response-is-object` rule holds JSON bodies only since the viewer answers HTML, and runs `oasdiff breaking` against the contract on `origin/main`. `scripts/check-chart.sh` lints `charts/savetab/` with the stand-in values of `charts/savetab/ci/lint-values.yaml` and runs the Conftest policies of `charts/savetab/policy/` on its render.
- `pnpm lint` needs semgrep on the PATH. `apps/server/scripts/semgrep.sh` tests then runs the rules in `apps/server/_semgrep/`, a name the Go tools and the archtest skip, one rule file with a test file of the same name each.
- `internal/platform/logline` holds every log key. A request writes one line, from `requestLine` in `internal/httpserver/requestline.go`. Code under a request adds to that line through the context: `logline.SetError`, `SetUser`, and the pgx tracer in `internal/db/tracer.go`. `wire.Run` builds the one logger and writes the start and stop lines. The Semgrep rules `log-through-logline` and `log-an-error-or-return-it` hold this.
- `internal/archtest` and the depguard rules in `apps/server/.golangci.yml` hold the layout. The allow-list at the top of `archtest_test.go` names what a later step removes: `internal/platform/testdb/testdb.go` at step 18. `internal/wire/routes_test.go` holds the routes to the spec, with only the probes outside it.
- The image takes its commit from the `COMMIT` build argument, and `version` stays `dev` until step 19 sets `VERSION`.

Orders from the owner that bind later steps:

- Every finding of the review gets fixed, architecture phase first, in the plan's step order.
- The steps run one after another without a pause for approval. Work stops only for a choice only the owner can make, and a session that runs short of context moves to a new one by itself.
- The image tag stays the commit SHA until step 19 moves it to the version. Step 19 is not pulled forward.
- `/v2` takes the practice's form. The owner's rulings on the contract are in the plan's Decisions section.
- A point the plan and the practice pages both leave open is asked of the owner, never settled in the spec.
- The server and the extension share one version and one `v<version>` tag per merge.
- The chart is `charts/savetab/` in this repository. Steps 11 and 19 change it in their own commit. A deploy moves `chartRevision` and `image.tag` together in `KOCEAN33/homelab-workloads` and is the owner's.

## Next steps

Steps 18 and 19 of the plan, in order, each with the done-when the plan gives.

# Next

## Goal

`apps/server` meets the owner's backend practice pages: every step of `docs/plans/server-practices.md` is committed with its checks green.

## Start

Step 16 of `docs/plans/server-practices.md`, migration and role timeouts, since every later step follows the plan's order. Steps 1 to 15 are committed.

The layers the remaining steps build on, with `internal/bus/ops.go` and `internal/db/ops.go` as the pattern files:

- sqlc generates `Queries` from `internal/db/queries.sql` per `apps/server/sqlc.yaml`: `db.New(tx)` inside a transaction, `store.Queries()` outside one. After a query change, run `sqlc generate` in `apps/server`. An id is a `uuid.UUID` from `db` through `bus`, and `api` parses it with `parseID`.
- Generated code returns the driver error as it is. `internal/db/mapped.go` sits under every `Queries` and maps it to a kind: `store.Queries()` and the `pgx.Tx` an `InTx` closure gets both run on it. A `Queries` built on a raw pool or transaction returns unmapped errors.
- `internal/db/dynamic.go` holds the SQL sqlc cannot compile: the pairing message update, whose column varies, and the migration runner's statements. Its functions take a `DBTX` and call `MapError` themselves.
- A `bus` use case opens the transaction with `store.InTx(ctx, fn)`, or `store.InSnapshot` for reads that must agree, holds the rule, and sets the kind of a broken rule with `errs.New`. `bus` declares the types `api` uses and holds token making, hashing, and every lifetime. `api.New` takes a `*bus.Bus`.
- The handler tests use `db` and pgx to write states the endpoints cannot produce, per step 3. The 39 handler tests in `internal/api` pin `/v1`.
- `internal/platform/config` loads every variable. `cmd/savetab-server` calls `wire.Main`, which loads the configuration and calls `wire.Run`. `wire.Run` (`internal/wire/wire.go`) uses every config field. The shutdown budget goes only to the start line, since the chart's grace period and the config validation are what act on it.
- `httpserver.New` (`internal/httpserver/server.go`) builds the `http.Server` on a gin engine with the request line middleware first, then the request deadline middleware. It mounts the `api.New` handler on `/v1`, `/s/`, and `/healthz` through `gin.WrapH`, and serves `/livez` and `/readyz`. Its `Serve` marks the listener open for `/readyz`. `httpserver.Status` is the kind-to-status function, unused until `/v2`.
- `pnpm check` needs golangci-lint v2, sqlc, sqlfluff, helm, and conftest on the PATH. `apps/server/scripts/check-sql.sh` runs `sqlc diff`, the parameter and type greps, and SQLFluff. `apps/server/scripts/test.sh` fails a full run when a generated query or a `dynamic.go` function runs in no test. `scripts/check-chart.sh` lints `charts/savetab/` with the stand-in values of `charts/savetab/ci/lint-values.yaml` and runs the Conftest policies of `charts/savetab/policy/` on its render.
- `pnpm lint` needs semgrep on the PATH. `apps/server/scripts/semgrep.sh` tests then runs the rules in `apps/server/_semgrep/`, a name the Go tools and the archtest skip, one rule file with a test file of the same name each.
- `internal/platform/logline` holds every log key. A request writes one line, from `requestLine` in `internal/httpserver/requestline.go`. Code under a request adds to that line through the context: `logline.SetError`, `SetUser`, `SetRoute`, and the pgx tracer in `internal/db/tracer.go`. `wire.Run` builds the one logger and writes the start and stop lines. The Semgrep rules `log-through-logline` and `log-an-error-or-return-it` hold this.
- `internal/archtest` and the depguard rules in `apps/server/.golangci.yml` hold the layout. The allow-list at the top of `archtest_test.go` names what a later step removes: `internal/platform/testdb/testdb.go` at step 18. No `/v1` file needs an entry.
- The image takes its commit from the `COMMIT` build argument, and `version` stays `dev` until step 19 sets `VERSION`.

Orders from the owner that bind later steps:

- Every finding of the review gets fixed, architecture phase first, in the plan's step order.
- The steps run one after another without a pause for approval. Work stops only for a choice only the owner can make, and a session that runs short of context moves to a new one by itself.
- The image tag stays the commit SHA until step 19 moves it to the version. Step 19 is not pulled forward.
- `/v2` takes the practice's form, and `/v1` goes once the extension has moved.
- The server and the extension share one version and one `v<version>` tag per merge.
- The chart is `charts/savetab/` in this repository. Steps 11 and 19 change it in their own commit. A deploy moves `chartRevision` and `image.tag` together in `KOCEAN33/homelab-workloads` and is the owner's.

## Next steps

Steps 16 to 19 of the plan, in order, each with the done-when the plan gives.

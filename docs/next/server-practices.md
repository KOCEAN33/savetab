# Next

## Goal

`apps/server` meets the owner's backend practice pages: every step of `docs/plans/server-practices.md` is committed with its checks green.

## Start

Step 13 of `docs/plans/server-practices.md`, the canonical log line, since every later step follows the plan's order. Steps 1 to 12 are committed.

The layers the remaining steps build on, with `internal/bus/ops.go` and `internal/db/ops.go` as the pattern files:

- `db` exports `Queries` over a `DBTX` (`internal/db/queries.go`): `db.New(tx)` inside a transaction, `store.Queries()` outside one. A `Queries` method holds one statement, every error through `MapError`.
- A `bus` use case opens the transaction with `store.InTx`, holds the rule, and sets the kind of a broken rule with `errs.New`. `bus` declares the types `api` uses and holds token making, hashing, and every lifetime. `api.New` takes a `*bus.Bus`.
- The handler tests use `db` and pgx to write states the endpoints cannot produce, per step 3. The 39 handler tests in `internal/api` pin `/v1` through step 13.
- `internal/platform/config` loads every variable. `wire.Run` (`internal/wire/wire.go`) uses every config field except the shutdown budget, which only the chart's grace period and the config validation read.
- `httpserver.New` (`internal/httpserver/server.go`) builds the `http.Server` on a gin engine with the request deadline middleware. It mounts the `api.New` handler on `/v1`, `/s/`, and `/healthz` through `gin.WrapH`, and serves `/livez` and `/readyz`. Its `Serve` marks the listener open for `/readyz`. `httpserver.Status` is the kind-to-status function, unused until `/v2`.
- `pnpm check` needs golangci-lint v2, helm, and conftest on the PATH. `scripts/check-chart.sh` lints `charts/savetab/` with the stand-in values of `charts/savetab/ci/lint-values.yaml` and runs the Conftest policies of `charts/savetab/policy/` on its render.
- `pnpm lint` needs semgrep on the PATH. `apps/server/scripts/semgrep.sh` tests then runs the rules in `apps/server/semgrep/`, where step 13 adds its rules beside `listen.yaml`.

Orders from the owner that bind later steps:

- Every finding of the review gets fixed, architecture phase first, in the plan's step order.
- `/v2` takes the practice's form, and `/v1` goes once the extension has moved.
- The server and the extension share one version and one `v<version>` tag per merge.
- The chart is `charts/savetab/` in this repository. Steps 11 and 19 change it in their own commit. A deploy moves `chartRevision` and `image.tag` together in `KOCEAN33/homelab-workloads` and is the owner's.

## Next steps

Steps 13 to 19 of the plan, in order, each with the done-when the plan gives.

# Next

## Goal

`apps/server` meets the owner's backend practice pages: every step of `docs/plans/server-practices.md` is committed with its checks green.

## Start

Step 11 of `docs/plans/server-practices.md`, the lifecycle endpoints, since every later step follows the plan's order. Steps 1 to 10 are committed.

The layers the remaining steps build on, with `internal/bus/ops.go` and `internal/db/ops.go` as the pattern files:

- `db` exports `Queries` over a `DBTX` (`internal/db/queries.go`): `db.New(tx)` inside a transaction, `store.Queries()` outside one. A `Queries` method holds one statement, every error through `MapError`.
- A `bus` use case opens the transaction with `store.InTx`, holds the rule, and sets the kind of a broken rule with `errs.New`. `bus` declares the types `api` uses and holds token making, hashing, and every lifetime. `api.New` takes a `*bus.Bus`.
- The handler tests use `db` and pgx to write states the endpoints cannot produce, per step 3. The 39 handler tests in `internal/api` pin `/v1` through step 13.
- `internal/platform/config` loads every variable. The readiness ping timeout and the shutdown budget are fields that steps 11 and 12 put to use. `main` already uses the start wait, the pool maximum, the HTTP drain timeout, and the request deadline.
- `httpserver.New` (`internal/httpserver/server.go`) builds the `http.Server` on a gin engine with the request deadline middleware. It mounts the `api.New` handler on `/v1`, `/s/`, and `/healthz` through `gin.WrapH`, so a new route such as `/livez` registers on the engine. `httpserver.Status` is the kind-to-status function, unused until `/v2`.
- `pnpm check` needs golangci-lint v2 on the PATH.

Orders from the owner that bind later steps:

- Every finding of the review gets fixed, architecture phase first, in the plan's step order.
- `/v2` takes the practice's form, and `/v1` goes once the extension has moved.
- The server and the extension share one version and one `v<version>` tag per merge.
- A chart change in `KOCEAN33/homelab-workloads` follows how the neighbouring charts there already do the same thing. Steps 11 and 19 commit theirs on a branch there and leave the deploy to the owner.

## Next steps

Steps 11 to 19 of the plan, in order, each with the done-when the plan gives.

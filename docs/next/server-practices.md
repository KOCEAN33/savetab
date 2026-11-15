# Next

## Goal

`apps/server` meets the owner's backend practice pages: every step of `docs/plans/server-practices.md` is committed with its checks green.

## Start

Step 9 of `docs/plans/server-practices.md`. Steps 1 to 8 are committed.

The server's layers as step 8 left them, with `internal/bus/ops.go` and `internal/db/ops.go` as the pattern files:

- `db` exports `Queries` over a `DBTX` (`internal/db/queries.go`): `db.New(tx)` inside a transaction, `store.Queries()` outside one. A `Queries` method holds one statement, every error through `MapError`. `Store` keeps only `Open`, `Close`, `Ping`, `Migrate`, `Queries`, and `InTx`.
- A `bus` use case opens the transaction with `store.InTx`, holds the rule, and sets the kind of a broken rule with `errs.New`. `bus` declares the types `api` uses, converts `db` rows to them, and holds token making and hashing and every lifetime.
- `InTx` maps its own error, so a begin or commit failure also carries a kind, and it retries 40001 and 40P01.
- `api.New` takes a `*bus.Bus`. No non-test file in `internal/api` imports `internal/db` or pgx. The handler tests still use `db` and pgx to write states the endpoints cannot produce, per step 3.
- Every later step leans on the 39 handler tests in `internal/api` as its pin. `pnpm check` needs golangci-lint v2 on the PATH.

Orders from the owner that bind later steps:

- Every finding of the review gets fixed, architecture phase first, in the plan's step order.
- `/v2` takes the practice's form, and `/v1` goes once the extension has moved.
- The server and the extension share one version and one `v<version>` tag per merge.
- A chart change in `KOCEAN33/homelab-workloads` follows how the neighbouring charts there already do the same thing.

## Next steps

Steps 9 to 19 of the plan, in order, each with the done-when the plan gives.

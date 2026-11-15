# Next

## Goal

`apps/server` meets the owner's backend practice pages: every step of `docs/plans/server-practices.md` is committed with its checks green.

## Start

Step 8 of `docs/plans/server-practices.md`, from its last entity: share. Steps 1 to 7 and the ops, key and snapshot, pairing, and login and session and device commits of step 8 are committed.

The ops commit set the form the other entities follow, with `internal/bus/ops.go` and `internal/db/ops.go` as the pattern files:

- `db` exports `Queries` over a `DBTX` (`internal/db/queries.go`): `db.New(tx)` inside a transaction, `store.Queries()` outside one. An entity's `Store` methods become `Queries` methods holding one statement each, every error through `MapError`.
- A `bus` use case opens the transaction with `store.InTx`, holds the rule, and sets the kind of a broken rule with `errs.New`. `bus` declares the types `api` uses and converts `db` rows to them.
- `InTx` maps its own error, so a begin or commit failure also carries a kind.
- Transitional until the share commit: `api.New` still takes `*db.Store` and builds the `bus` itself, and `/healthz` pings the store. The share commit ends both. The step is done when no file in `internal/api` imports `internal/db` or pgx. Every `db` function now returns a kinded error from `internal/platform/errs`, and transactions open through `Store.InTx`, which retries 40001 and 40P01. Every later step leans on the 39 handler tests in `internal/api` as its pin. `pnpm check` needs golangci-lint v2 on the PATH.

Orders from the owner that bind later steps:

- Every finding of the review gets fixed, architecture phase first, in the plan's step order.
- `/v2` takes the practice's form, and `/v1` goes once the extension has moved.
- The server and the extension share one version and one `v<version>` tag per merge.
- A chart change in `KOCEAN33/homelab-workloads` follows how the neighbouring charts there already do the same thing.

## Next steps

Steps 9 to 19 of the plan, in order, each with the done-when the plan gives.

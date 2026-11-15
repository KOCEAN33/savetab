# Next

## Goal

`apps/server` meets the owner's backend practice pages: every step of `docs/plans/server-practices.md` is committed with its checks green.

## Start

Step 8 of `docs/plans/server-practices.md`: `internal/bus` takes the use cases, one commit per entity in the order the plan lists. Steps 1 to 7 are committed. Every `db` function now returns a kinded error from `internal/platform/errs`, and transactions open through `Store.InTx`, which retries 40001 and 40P01. Every later step leans on the 39 handler tests in `internal/api` as its pin. `pnpm check` needs golangci-lint v2 on the PATH.

Orders from the owner that bind later steps:

- Every finding of the review gets fixed, architecture phase first, in the plan's step order.
- `/v2` takes the practice's form, and `/v1` goes once the extension has moved.
- The server and the extension share one version and one `v<version>` tag per merge.
- A chart change in `KOCEAN33/homelab-workloads` follows how the neighbouring charts there already do the same thing.

## Next steps

Steps 9 to 19 of the plan, in order, each with the done-when the plan gives.

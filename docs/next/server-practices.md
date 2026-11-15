# Next

## Goal

`apps/server` meets the owner's backend practice pages: every step of `docs/plans/server-practices.md` is committed with its checks green.

## Start

Step 3 of `docs/plans/server-practices.md`: the test-only exports `CreateUser`, `CreateDevice`, and `IssueSession` leave `store`. Steps 1 and 2 are committed. Every later step leans on the 39 handler tests as its pin.

Orders from the owner that bind later steps:

- Every finding of the review gets fixed, architecture phase first, in the plan's step order.
- `/v2` takes the practice's form, and `/v1` goes once the extension has moved.
- The server and the extension share one version and one `v<version>` tag per merge.
- A chart change in `KOCEAN33/homelab-workloads` follows how the neighbouring charts there already do the same thing.

## Next steps

Steps 4 to 19 of the plan, in order, each with the done-when the plan gives.

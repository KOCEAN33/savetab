# Next

## Goal

`apps/server` meets the owner's backend practice pages: every step of `docs/plans/server-practices.md` is committed with its checks green.

## Start

Step 1 of `docs/plans/server-practices.md`: `apps/server/scripts/test.sh` runs `go test -race -count=1 -shuffle=on ./...`. It is first because the owner ordered the architecture phase first, and every later step leans on the 39 handler tests as its pin. Done when `pnpm --filter @savetab/server test` passes with no `(cached)` line.

Orders from the owner that bind later steps:

- Every finding of the review gets fixed, architecture phase first, in the plan's step order.
- `/v2` takes the practice's form, and `/v1` goes once the extension has moved.
- The server and the extension share one version and one `v<version>` tag per merge.
- A chart change in `KOCEAN33/homelab-workloads` follows how the neighbouring charts there already do the same thing.

Questions the owner has not answered. Steps 1 to 14 need none of them:

- Whether `cmd/savetab-e2e` stays as a second main package or goes.
- The two `/v2` departures and the proposed path names in step 17 of the plan.

## Next steps

Steps 2 to 19 of the plan, in order, each with the done-when the plan gives.

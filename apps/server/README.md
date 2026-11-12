# savetab server

The sync server: Go and Postgres. Its contract is the `### P4: sync server` section of `docs/plans/onetab-parity.md`.

## Run

The server applies its migrations at start, and reads the issuer's discovery document, so the issuer must be reachable then.

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Postgres URL. Required. |
| `LISTEN_ADDR` | Listen address. Default `:8080`. |
| `OIDC_ISSUER` | Issuer URL of the OIDC provider. Required. |
| `OIDC_CLIENT_ID` | Client id registered at the issuer. Required. |
| `OIDC_CLIENT_SECRET` | Client secret. Leave unset for a public client. |
| `PUBLIC_URL` | The server's base URL as browsers reach it. Required. The issuer's redirect URI is `<PUBLIC_URL>/v1/auth/callback`. |
| `AUTH_REDIRECT_URIS` | Space-separated redirect URIs a login may end at. Required. Each extension's is the value of `browser.identity.getRedirectURL()`. |

```bash
DATABASE_URL=postgres://... OIDC_ISSUER=https://... go run ./cmd/savetab-server
```

## Test

Tests run against a real Postgres. Each run creates a database `savetab_test_<random>` on the server that `TEST_DATABASE_URL` names and drops it at the end, so the role needs `CREATEDB`.

`pnpm test` calls `scripts/test.sh`. Without `TEST_DATABASE_URL`, the script uses the homelab dev cluster `pg-dev.lab.hiriri.com` as role `agent` acting as `savetab`, which needs the tailnet and the `proxmox-talos-lab-op` keychain token. CI sets `TEST_DATABASE_URL` to its Postgres service container.

## Server for the extension's e2e tests

`scripts/e2e-server.sh` builds and runs `cmd/savetab-e2e`: the API on a free local port, on a `savetab_test_<random>` database of its own, with an OIDC issuer it runs itself (`internal/fakeoidc`) that logs every visitor in as one user. It prints its URL as the first line of stdout and drops the database on SIGTERM. `AUTH_REDIRECT_URIS` sets the redirect URIs a login may end at. It finds the database the way `scripts/test.sh` does, through `scripts/test-db.sh`.

## Deployment

The server runs on the homelab cluster at `https://savetab.lab.hiriri.com`, reachable on the tailnet only by the owner's decision. The cluster's rules are in the vault: `vault-memory get projects/homelab/gitops.md`.

- Image: `.github/workflows/image.yml` pushes `ghcr.io/kocean33/savetab:<full commit sha>` on a push to `main` that touches the server's sources. The package is public.
- Chart and values: `KOCEAN33/homelab-workloads`, `charts/savetab/` and `savetab/envs/`. A deploy is a commit there that sets `image.tag` in `savetab/envs/prod.yaml`. Argo CD syncs it as the Application `savetab-prod`.
- Database: role and database `savetab` on the production Postgres, declared in `KOCEAN33/homelab-platform` `manifest/postgres/`. The password is the 1Password item `savetab-db` in the vault `Homelab`. The server connects to `postgres-rw.postgres.svc`, not the pooler, because pgx's statement cache does not survive transaction pooling.
- Login: Zitadel at `https://auth.hiriri.com`, project `savetab`, application `savetab`, a public client on PKCE with no client secret. The project admits only users who hold the role `savetab-user`.
- `AUTH_REDIRECT_URIS` in `savetab/envs/prod.yaml` holds the Firefox add-on's URI, the SHA-1 of `savetab@kocean33` under `extensions.allizom.org`, and the Chrome GitHub Releases build's `https://mjkkpkbgjflhjgdkhhnejpjcdkfcpmkb.chromiumapp.org/`, whose id the manifest `key` fixes (`apps/extension/wxt.config.ts`). A Chrome Web Store item has its own id and needs its URI added.
- Check: `curl https://savetab.lab.hiriri.com/healthz` answers `{"ok":true}`.


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

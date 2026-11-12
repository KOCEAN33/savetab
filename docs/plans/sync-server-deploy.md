# Plan: deploy the sync server to the homelab

Plan P4 step 9 of `docs/plans/onetab-parity.md`, pulled ahead of steps 6 to 8 by the owner. The server runs on the homelab cluster from a Helm chart in `KOCEAN33/homelab-workloads`. The rules of that cluster are in the vault: `vault-memory get projects/homelab/gitops.md`, `projects/homelab/secrets.md`, and `projects/homelab/postgres-for-app-agents.md#putting-an-app-on-prod`. Load the `homelab-cluster` skill before any `kubectl`.

No extension can log in until the account UI (step 6) exists, so the deployed server is checked through `/healthz` and a login run by hand.

## Waiting on the owner

- Tailnet-only or public. Tailnet-only is `savetab.lab.hiriri.com`: a device syncs only on the tailnet, and nothing outside `homelab-workloads` and the database files changes. Public is `savetab.hiriri.com`: it adds one Ingress to homelab-platform `manifest/gateway/tunnel-ingress.yaml`, a second HTTPRoute that sets `X-Forwarded-Proto: https`, and a line in proxmox-talos-lab ADR public-path. `GET /v1/auth/start` has no rate limit (`docs/candidates.md`).
- Permission for the production database commit in homelab-platform. It is valid only in the conversation that makes the commit.
- The Zitadel application. Registration is console work by hand at `https://auth.lab.hiriri.com/ui/console` (homelab-platform `docs/zitadel-oidc-setup.md`).

## Shape

- Image: `ghcr.io/kocean33/savetab:<full commit sha>`, built by `.github/workflows/image.yml` on a push to `main` that touches `apps/server/**`. `apps/server/Dockerfile` builds `./cmd/savetab-server` with `CGO_ENABLED=0` and copies it into `gcr.io/distroless/static-debian12:nonroot`. Pattern for the workflow: `saveweb/.github/workflows/image.yml`. `cmd/savetab-e2e` stays out of the image.
- Chart: homelab-workloads `charts/savetab/`, `savetab/appset.yaml`, `savetab/envs/default.yaml`, `savetab/envs/prod.yaml`. Copy the shape of `charts/saveweb/` and `saveweb/appset.yaml`: release name and namespace `savetab-prod`, one Deployment with `strategy: Recreate` because every start applies migrations, a Service on port 80 to container port 8080, a readiness probe on `/healthz`, the pod and container security contexts of `charts/saveweb/templates/_helpers.tpl`, and an HTTPRoute with every Gateway API default written out.
- Environment of the container, from `apps/server/README.md`:

  | Variable | Source |
  | --- | --- |
  | `DATABASE_URL` | key `url` of the Secret `savetab-db` |
  | `OIDC_ISSUER` | `https://auth.hiriri.com` |
  | `OIDC_CLIENT_ID` | values file, from the Zitadel application |
  | `OIDC_CLIENT_SECRET` | key `oidc_client_secret` of the Secret `savetab` |
  | `PUBLIC_URL` | `https://<host>` |
  | `AUTH_REDIRECT_URIS` | values file, space-separated |

- Secrets, each an `ExternalSecret` in the chart with `creationPolicy: Owner`, `deletionPolicy: Retain`, and the `SkipDryRunOnMissingResource=true` annotation: `savetab-db` from 1Password `savetab-db/password` in the basic-auth shape with a `url` key, `savetab` from `savetab-prod/oidc_client_secret`, and `ghcr-pull` when the package is private. Both 1Password items live in the vault `Homelab` and carry a `used_by` field.
- Database: role `savetab` without `createdb`, `Database` `savetab`, and the `ExternalSecret` `savetab-db` in namespace `postgres`, in homelab-platform `manifest/postgres/`. The server connects to `postgres-rw.postgres.svc:5432` unless `store.Open` turns pgx's statement cache off: named prepared statements do not survive the pooler. The values file records which one it uses and why.
- Zitadel: a project `savetab` of its own, because the server gives an account to anyone the issuer logs in. One Web application, authorization code with PKCE, redirect URI `<PUBLIC_URL>/v1/auth/callback`.
- `AUTH_REDIRECT_URIS` holds each extension's `browser.identity.getRedirectURL()`. Firefox derives it from the add-on id `savetab@kocean33`. A guess, to check in a running Firefox: `https://c08ee3b54ec445c7e6fa5980ba443ce6d97ce5d0.extensions.allizom.org/`, the SHA-1 of the id. Chrome's is `https://<extension id>.chromiumapp.org/`, and the id is fixed only by a `key` in the manifest or by the store item. Until step 6 settles them, the value holds the Firefox URI.

## Steps

1. `apps/server/Dockerfile` and `.github/workflows/image.yml` in savetab. Done when the workflow run pushes the image and `docker run` of it with no environment exits with `DATABASE_URL is not set`.
2. The two 1Password items. `savetab-db` holds `password` from `openssl rand -base64 32 | tr -d '\n'`.
3. The Zitadel application, then `oidc_client_secret` into `savetab-prod` and the client id into `savetab/envs/prod.yaml`.
4. The database commit in homelab-platform, after the owner's permission. Done when the `Database` `savetab` reads applied and the Secret `savetab-db` exists in `postgres`.
5. The chart, the appset, and the values files in homelab-workloads, pushed after step 4. `helm template` renders before the push.
6. Public only: the Ingress and the second HTTPRoute.
7. Smoke test. Done when `curl https://<host>/healthz` answers `{"ok":true}`, `curl -si https://<host>/v1/auth/start?...` with a listed redirect URI answers a 302 to `auth.hiriri.com`, and `argocd app list` reports `savetab-prod` `Synced` and `Healthy`.
8. `apps/server/README.md` gains the deployed URL and where the chart lives, the plan's step 9 points here as built, and the vault page `projects/savetab.md` gets the URL.

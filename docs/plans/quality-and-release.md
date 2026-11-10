# Plan: review, lint rules, Firefox automation, releases

Goal: before P4 starts, the code is reviewed, lint holds the rules the review found, the Firefox check runs without a GUI, and a pushed tag publishes installable builds to GitHub Releases.

## Interfaces

- `pnpm test:e2e:firefox` (root and `apps/extension`): builds `wxt build -b firefox --mode e2e`, then drives Firefox headless. Specs live in `apps/extension/e2e-firefox/`.
- Firefox driver: `selenium-webdriver` with geckodriver (classic WebDriver). geckodriver runs with `--allow-system-access`, which lets WebDriver open `moz-extension://` pages. Without the flag Firefox refuses them, as it does for Playwright and puppeteer BiDi (`docs/guides/firefox-check.md`).
- `.github/workflows/ci.yml`: on push and pull request, runs `pnpm test`, `pnpm check`, `pnpm lint`, `pnpm test:e2e`, `pnpm test:e2e:firefox`.
- `.github/workflows/release.yml`: on tag `v<semver>`, runs the same checks, then publishes a GitHub Release with these assets:
  - `savetab-<version>-chrome.zip`: unzip, then load unpacked from `chrome://extensions`.
  - `savetab-<version>-firefox.xpi`: signed through AMO on the unlisted channel, so release Firefox installs it from the download link. Needs repo secrets `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`. Without them the workflow uploads the unsigned zip and says so in the release notes.
  - `savetab-<version>-sources.zip`: the source archive AMO review asks for.
  - `updates.json`: the Firefox update manifest.
- Self-distributed Firefox builds set `browser_specific_settings.gecko.update_url` to `https://github.com/KOCEAN33/savetab/releases/latest/download/updates.json`, so an installed xpi updates itself. The build sets it only when `SAVETAB_SELF_DISTRIBUTED=1`, so the store build has none and Firefox updates a listed add-on from AMO.
- The tag version must equal `apps/extension/package.json` `version`. The workflow fails otherwise.
- Install and release steps: `docs/guides/release.md`. Store registration: `docs/guides/store-registration.md`, with the general part in the vault page `wiki/extension-store-publishing.md`.

## Order

1. In parallel: architecture and code review (read-only), Firefox automation, release workflows, store registration research.
2. After the review lands: add the lint rules it proposed, and record its defects and structural findings in `docs/candidates.md`. Fixing them is a separate change the user approves.
3. Write the store registration docs and the vault page.
4. Update `CLAUDE.md` and `docs/guides/firefox-check.md` to the new commands.

## Done when

- `pnpm test`, `pnpm test:e2e`, `pnpm test:e2e:firefox`, `pnpm check`, `pnpm lint` pass locally.
- `pnpm test:e2e:firefox` covers step 4 of the GUI check: the toolbar action stores the open tabs, and a click on a title restores it.
- Each new lint rule fails on a deliberate violation.
- `pnpm lint` runs oxlint with `.oxlintrc.json`, stylelint, and `scripts/lint-conventions.mjs`, which holds the repo rules oxlint cannot express.
- `actionlint` passes on both workflows, and the release packaging steps run locally to the three unsigned assets.

## Waiting on the user

- The GitHub repository `KOCEAN33/savetab` does not exist, and its visibility is the user's call. The workflows run only after it exists.
- AMO API credentials for signing.

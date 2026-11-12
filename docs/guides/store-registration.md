# Store registration

How savetab gets listed on the Chrome Web Store and on Firefox Add-ons (AMO). The general procedure for any extension is in the vault under `wiki/browser-extensions/`: read a unit with `vault-memory get <id>`. This file holds only what is specific to savetab.

Neither store requires open source. Both are unregistered for savetab: the developer accounts, the listings, and the privacy policy do not exist yet.

## Before either store

- A privacy policy at a public URL. Chrome requires one even when data stays on the device (`wiki/browser-extensions/chrome-web-store-review.md#privacy-policy-and-user-data`). It states that savetab stores tab URLs, titles, notes, and settings in the browser's IndexedDB and `storage.local`, and sends nothing to the developer.
- The sync release changes what leaves the device. Update the policy, the Chrome data usage disclosures, and `data_collection_permissions` in `apps/extension/wxt.config.ts` in the same release.
- Screenshots of the list page at 1280x800 and a 128x128 icon (`wiki/browser-extensions/chrome-web-store-publishing.md#store-listing-assets`).
- The Korean strings in `apps/extension/locales/ko.json` reviewed, since the listing reuses them.

## Chrome Web Store

Steps: `wiki/browser-extensions/chrome-web-store-publishing.md#developer-registration`, then `#submission-steps`. Upload `savetab-<version>-chrome.zip` from a GitHub Release, or the output of `pnpm --filter @savetab/extension zip`.

The Privacy tab asks for one justification per permission (`#privacy-practices-tab`). savetab's reasons:

| Permission | Why savetab needs it |
| --- | --- |
| `tabs` | Reads the URL and title of each tab it stores, and closes and reopens tabs. |
| `tabGroups` | Stores a browser tab group's name and color, and restores the group. |
| `storage` | Keeps the weekly backup in `storage.local` (`lib/backup.ts`), apart from IndexedDB. |
| `unlimitedStorage` | The list and its backup grow past the default quota for users with many stored tabs. |
| `contextMenus` | The "Send to savetab" entries on pages, tabs, and links. |
| `alarms` | Schedules the weekly backup. |
| `favicon` | Shows each stored tab's site icon. |
| `identity` | Opens the sign-in window of the user's own sync server (`lib/account.ts`). |
| `bookmarks` (optional) | Imports bookmark folders when the user asks. |
| `readingList` (optional) | Imports the reading list when the user asks. |

- Single purpose: save open tabs to a list and restore them.
- Remote code: none.
- The trader declaration publishes the name, phone, and address of a trader on the listing (`#trader-declaration`). Which status applies is the owner's call.
- Review rejections name an id such as Purple Potassium for an unused permission (`wiki/browser-extensions/chrome-web-store-review.md#rejection-notification-ids`). A permission savetab stops using leaves `wxt.config.ts` in the same change.

## Firefox Add-ons

Steps: `wiki/browser-extensions/firefox-add-on-submission.md#developer-account`, then `#submission-steps`.

- The add-on id is `savetab@kocean33`. The GitHub Release workflow signs it on the unlisted channel (`docs/guides/release.md`). One add-on holds versions in both channels, and a version number is used once across them (`#listed-and-unlisted-channels`). Submit a listed version with a number no unlisted release has used.
- The listed build is the default `wxt build -b firefox`, without `SAVETAB_SELF_DISTRIBUTED`, so it has no `update_url` and Firefox updates it from AMO (`wiki/browser-extensions/firefox-browser-specific-settings.md#update-url`).
- AMO asks for source code, because the build is bundled (`#source-code-package`). Upload `savetab-<version>-sources.zip`. WXT's own sources zip lacks `packages/core` and `pnpm-lock.yaml`, so a reviewer cannot rebuild from it. The rebuild steps for Notes for Reviewers are in `docs/guides/release.md` under "Rebuild from source", with the listed build's command `pnpm --filter @savetab/extension build:firefox`.
- `data_collection_permissions` is `required: ['none']` (`wiki/browser-extensions/firefox-browser-specific-settings.md#data-collection-permissions`). It holds while nothing leaves the device.
- Run `npx web-ext lint -s apps/extension/.output/firefox-mv3` before the upload. AMO runs the same validation.

## Automated submission

`wxt submit` uploads to both stores once each listing exists (`wiki/browser-extensions/wxt-publishing.md#wxt-submit`). The first submission to each store is by hand. Chrome needs the publisher id and a service account: the OAuth variables in WXT's example use an API version past its end date (`wiki/browser-extensions/chrome-web-store-api.md#api-versions`). No workflow in this repo submits to a store.

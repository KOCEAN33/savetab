# Browser API constraints

Chrome and Firefox differences that shape savetab's P3 steps (`docs/plans/onetab-parity.md`). A line marked _(unverified)_ comes from code reading or an old report. Its step's check confirms it in a real run.

## Tab groups

- Permission `tabGroups`. Chrome: `tabs.group` and `Tab.groupId` since 88, `tabGroups` since 89. Firefox: `tabs.group` and `Tab.groupId` since 138, `tabGroups` since 139. Firefox for Android has neither.
- Both: `tabs.group({ tabIds })` without `groupId` makes a group. `tabGroups.update` sets `title`, `color`, `collapsed`. `tabGroups.query({ windowId })` lists a window's groups.
- Whether Firefox accepts all nine Chrome colors is _(unverified)_.
- Sources: [MDN tabGroups](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabGroups), [Chrome tabGroups](https://developer.chrome.com/docs/extensions/reference/api/tabGroups).

## Reading list and bookmarks

- Chrome has `readingList` (Chrome 120+, MV3 only). It can be an optional permission: the savetab e2e build lists it in `optional_permissions` and loads. Firefox has no reading list API.
- `bookmarks` is allowed in `optional_permissions` in both browsers. `permissions.request` must run inside a user gesture, and resolves to `true` or `false` for the whole set.
- Sources: [Chrome readingList](https://developer.chrome.com/docs/extensions/reference/api/readingList), [MDN permissions.request](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/permissions/request).

## Discarded tabs

- Firefox: `tabs.create({ discarded: true, title })` opens a tab unloaded. `title` is allowed only with `discarded: true`.
- Chrome: `tabs.create` has no `discarded`. Create with `active: false`, then `tabs.discard(tabId)`. `tabs.discard` fails on the active tab. A tab discarded after its first `tabs.onUpdated` with a `url` keeps that URL (savetab e2e, `restore-targets.spec.ts`).
- Sources: [MDN tabs.create](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/create), [Chrome tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs).

## Private windows

- Chrome: without "Allow in Incognito", `windows.create({ incognito: true })` still opens a window but resolves to `undefined`. With `incognito: "spanning"`, an extension page cannot load in an incognito window and opens in a normal one.
- Firefox: without "Run in Private Windows", `windows.create({ incognito: true })` rejects with `Extension does not have permission for incognito mode`. Firefox does not support `"split"`.
- Both: `extension.isAllowedIncognitoAccess()` reports the user's grant.
- Sources: [Chromium windows_api.cc](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/extensions/api/tabs/windows_api.cc), [Firefox ext-windows.js](https://github.com/mozilla-firefox/firefox/blob/main/browser/components/extensions/parent/ext-windows.js).

## URLs an extension cannot open

- Chrome rejects `javascript:`, `devtools://`, `chrome-untrusted://`, `chrome://feedback`, crash and kill pages such as `chrome://crash` (savetab e2e confirms `tabs.create` rejects it), and `file:` without "Allow access to file URLs". Other `chrome://` pages and `about:blank` open.
- Firefox rejects privileged `about:` pages (`about:config`, `about:addons`, `about:debugging`), `chrome:`, `javascript:`, `data:`, and `file:`, with `Illegal URL: <url>`.
- Sources: [Chromium extension_tab_util.cc](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/extensions/extension_tab_util.cc), [Firefox ext-tabs.js](https://github.com/mozilla-firefox/firefox/blob/main/browser/components/extensions/parent/ext-tabs.js).

## Language

- `browser.i18n.getMessage` follows the browser UI language and takes no locale argument, so an extension cannot switch its own language at runtime. A missing message returns `""`.
- Manifest strings use `__MSG_<key>__` from `_locales/<lang>/messages.json`, which needs `default_locale`.
- Sources: [WXT i18n](https://wxt.dev/i18n.html), [MDN i18n.getMessage](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/i18n/getMessage).

## Color scheme

- Firefox extension pages see `prefers-color-scheme`, and it follows the Firefox theme, which follows the system under the default theme. Chrome's behavior in extension pages is _(unverified)_.
- Source: [Mozilla bug 1593355](https://bugzilla.mozilla.org/show_bug.cgi?id=1593355).

## Downloads

- A Blob URL with `<a download>` needs no permission in Chrome: the savetab e2e catches the download. Firefox ignored `download` on extension pages for `data:` URLs in 2017 _(unverified on current Firefox)_. `downloads.download` needs the `downloads` permission, which can be optional in both browsers.
- Source: [Mozilla bug 1379960](https://bugzilla.mozilla.org/show_bug.cgi?id=1379960).

## Storage lifetime

- Chrome: `unlimitedStorage` lifts the `storage.local` quota and exempts IndexedDB from eviction. Clearing browsing data leaves extension storage.
- Firefox: `unlimitedStorage` lifts the `storage.local` limit and makes IndexedDB persistent without a prompt.
- Both browsers delete `storage.local` and IndexedDB on uninstall, so a backup inside the extension does not survive a reinstall.
- Sources: [Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage), [MDN storage.local](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/local).

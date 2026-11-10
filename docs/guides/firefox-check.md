# Firefox check

## Automated run

`pnpm test:e2e:firefox`, from the repo root or `apps/extension`, is the Firefox check. It builds `wxt build -b firefox --mode e2e`, then runs the vitest specs in `apps/extension/e2e-firefox/` (config `e2e-firefox/vitest.config.ts`) against Firefox. Set `HEADED=1` to show the window.

- Each test starts Firefox through `selenium-webdriver` and geckodriver on a fresh temporary profile, installs the build as a temporary add-on, and quits Firefox when the test ends, failed or not.
- geckodriver runs with `--allow-system-access`. Without it Marionette refuses every command on a `moz-extension://` page with `UnsupportedOperationError`. Playwright cannot load Firefox extensions at all, and puppeteer over WebDriver BiDi hits the same refusal.
- The pref `extensions.webextensions.uuids` pins the extension UUID, so the specs open `moz-extension://<uuid>/onetab.html` directly.
- The toolbar code path runs through `globalThis.savetabTest` in the event-page background. A control window holds an extension page that calls `browser.runtime.getBackgroundPage()` (`evaluate` and `sendWindow` in `e2e-firefox/fixtures.ts`).
- Selenium Manager finds Firefox and downloads geckodriver into `~/.cache/selenium` when neither is on `PATH`.
- Covered: the toolbar action stores and closes the site tabs and the list shows the total, a click on a stored title reopens it and the total drops by one, pinned tabs stay open, an options choice persists across a reload, and import then export of `URL | Title` text.

Before a release, also lint the production build: `pnpm build`, then `npx web-ext lint -s apps/extension/.output/firefox-mv3` from the repo root. Done when errors is 0. The one warning is Svelte's runtime `innerHTML` template use.

## GUI check

The automated run drives page content only and asserts no looks, so check these by hand when a change touches them:

- The toolbar button itself, and the send popup it opens with the "popup" toolbar action.
- Context menus, including the "Send this tab to" submenu.
- Keyboard shortcuts (`commands`) and the omnibox keyword `11`.
- Appearance: theme, layout, and the Korean UI.

1. Run in a temporary profile, from `apps/extension`:
   `npx web-ext run -s .output/firefox-mv3 --no-reload --firefox=/Applications/Firefox.app/Contents/MacOS/firefox --start-url https://example.com/ --start-url https://example.org/`
   Wait for `Installed ... as a temporary add-on` in its output. Its Firefox pid is the `firefox ... -profile .../firefox-profile...` process started last: `pgrep -fl firefox-profile` lists it, and an older one is a leftover run.
2. Drive the window with the `orca-computer` skill, targeting the web-ext Firefox by pid (`--app pid:<pid>`). The bundle id resolves to the user's own Firefox instead. Probe first with `orca computer get-app-state --app com.apple.finder`. When it fails with `permission_denied` "no accessibility window" on every app while `orca computer permissions` reports granted, the macOS Accessibility grant is stale. The user clears it by turning Orca Computer Use off and on in System Settings > Privacy & Security > Accessibility, so stop and ask.
3. Stop the run with `pkill -f "web-ext run -s .output/firefox-mv3"`, then kill its Firefox pid. Killing web-ext leaves Firefox running.

Driving notes:

- Firefox has the Korean IME active. `type-text` and `paste-text` into a page input double or mangle the text, so fill page inputs with `set-value`. It often reports `verification_failed` while the value did land, so check the page result instead. The address bar takes `type-text` after Select All and Backspace.
- The web-ext Firefox UI is Korean, so savetab's Language "Automatic" shows Korean. Choose English on the options page before following English labels.
- To copy page content, drag-select it, then press Cmd+C. Cmd+C after Select All copies nothing.
- macOS dark mode makes the theme "Automatic" dark too. Compare a Light screenshot to see the Dark setting.
- A tab row's "More actions" button shows only on hover or focus. Click empty space on the row first, then use the button's element index.
- Native context submenus, such as "Send this tab to", are absent from the accessibility tree. Open them with the Right and Down keys and read them from the screenshot.

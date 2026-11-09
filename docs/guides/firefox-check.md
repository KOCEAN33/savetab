# Firefox check

Playwright cannot load extensions into Firefox, and WebDriver BiDi (puppeteer) installs the extension but cannot open or list `moz-extension://` pages. So the Firefox check is a GUI run.

1. Build and lint: `pnpm build`, then `npx web-ext lint -s apps/extension/.output/firefox-mv3` from the repo root. Done when errors is 0. The one warning is Svelte's runtime `innerHTML` template use.
2. Run in a temporary profile, from `apps/extension`:
   `npx web-ext run -s .output/firefox-mv3 --no-reload --firefox=/Applications/Firefox.app/Contents/MacOS/firefox --start-url https://example.com/ --start-url https://example.org/`
   Wait for `Installed ... as a temporary add-on` in its output. Its Firefox pid is the `firefox ... -profile .../firefox-profile...` process started last: `pgrep -fl firefox-profile` lists it, and an older one is a leftover run.
3. Drive the window with the `orca-computer` skill, targeting the web-ext Firefox by pid (`--app pid:<pid>`). The bundle id resolves to the user's own Firefox instead. Probe first with `orca computer get-app-state --app com.apple.finder`. When it fails with `permission_denied` "no accessibility window" on every app while `orca computer permissions` reports granted, the macOS Accessibility grant is stale. The user clears it by turning Orca Computer Use off and on in System Settings > Privacy & Security > Accessibility, so stop and ask.
4. Click the savetab toolbar button. Done when the site tabs close and the list shows `Total: N tabs`. Click a title. Done when that site opens and the total drops by one.
5. Stop the run with `pkill -f "web-ext run -s .output/firefox-mv3"`, then kill its Firefox pid. Killing web-ext leaves Firefox running.

Driving notes:

- Firefox has the Korean IME active. `type-text` and `paste-text` into a page input double or mangle the text, so fill page inputs with `set-value`. The address bar takes `type-text` after Select All and Backspace.
- A tab row's "More actions" button shows only on hover or focus. Click empty space on the row first, then use the button's element index.
- Native context submenus, such as "Send this tab to", are absent from the accessibility tree. Open them with the Right and Down keys and read them from the screenshot.

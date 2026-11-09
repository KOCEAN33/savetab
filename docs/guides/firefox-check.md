# Firefox check

Playwright cannot load extensions into Firefox, and WebDriver BiDi (puppeteer) installs the extension but cannot open or list `moz-extension://` pages. So the Firefox check is a GUI run.

1. Build and lint: `pnpm build`, then `npx web-ext lint -s apps/extension/.output/firefox-mv3` from the repo root. Done when errors is 0. The one warning is Svelte's runtime `innerHTML` template use.
2. Run in a temporary profile, from `apps/extension`:
   `npx web-ext run -s .output/firefox-mv3 --no-reload --firefox=/Applications/Firefox.app/Contents/MacOS/firefox --start-url https://example.com/ --start-url https://example.org/`
   Wait for `Installed ... as a temporary add-on` in its output.
3. Drive the window with the `orca-computer` skill, targeting the web-ext Firefox by pid (`--app pid:<pid>`). The bundle id resolves to the user's own Firefox instead.
4. Click the savetab toolbar button. Done when the site tabs close and the list shows `Total: N tabs`. Click a title. Done when that site opens and the total drops by one.
5. Stop the run with `pkill -f "web-ext run -s .output/firefox-mv3"`.

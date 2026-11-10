import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { By, until, type WebDriver, type WebElement } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { test as base, expect } from 'vitest';

const EXTENSION = path.resolve(import.meta.dirname, '../.output/firefox-mv3-e2e');
const GECKO_ID = 'savetab@kocean33';
/** Pinned through the `extensions.webextensions.uuids` pref, so page URLs are known before install. */
const UUID = '5a7e7ab0-0000-4000-8000-000000000e2e';
export const EXT = `moz-extension://${UUID}`;

const server = createServer((req, res) => {
  const n = (req.url ?? '/').slice(1);
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<title>Page ${n}</title><h1>Page ${n}</h1>`);
}).listen(0, '127.0.0.1');
server.unref();
await new Promise((r) => server.once('listening', r));
export const SITE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

export interface Firefox {
  driver: firefox.Driver;
  /** The first window, where site tabs open. */
  siteWindow: string;
  /** A window holding an extension page, from which `evaluate` reaches the extension APIs. */
  controlWindow: string;
}

export const test = base.extend<{ ff: Firefox }>({
  // Vitest requires an object pattern for the fixtures argument, even an empty one.
  // oxlint-disable-next-line no-empty-pattern
  ff: async ({}, use) => {
    const options = new firefox.Options().setPreference(
      'extensions.webextensions.uuids',
      JSON.stringify({ [GECKO_ID]: UUID }),
    );
    if (!process.env.HEADED) options.addArguments('-headless');
    // Without system access Marionette refuses every command on a moz-extension:// page.
    const service = new firefox.ServiceBuilder().addArguments('--allow-system-access').build();
    // geckodriver starts Firefox on a fresh temporary profile and deletes it on quit.
    const driver = await firefox.Driver.createSession(options, service);
    try {
      await driver.installAddon(EXTENSION, true);
      const siteWindow = await driver.getWindowHandle();
      await driver.switchTo().newWindow('window');
      const controlWindow = await driver.getWindowHandle();
      await driver.get(`${EXT}/options.html`);
      // Firefox's own UI language would pick the page language under "Automatic".
      await driver.executeScript(`return browser.storage.local.set({ deviceSettings: { language: 'en' } })`);
      await driver.switchTo().window(siteWindow);
      await use({ driver, siteWindow, controlWindow });
    } finally {
      await driver.quit();
    }
  },
});

export { expect };

/**
 * Run `fn` in the control window's extension page and return its result. `fn` is serialized,
 * so it can use only its arguments and the page globals.
 */
export async function evaluate<A extends unknown[], R>(
  { driver, controlWindow }: Firefox,
  fn: (...args: A) => Promise<R>,
  ...args: A
): Promise<R> {
  const back = await driver.getWindowHandle();
  await driver.switchTo().window(controlWindow);
  try {
    const out: { value?: R; error?: string } = await driver.executeAsyncScript(
      `const done = arguments[arguments.length - 1];
      (${fn.toString()})(...Array.from(arguments).slice(0, -1)).then(
        (value) => done({ value }),
        (e) => done({ error: String(e) }),
      );`,
      ...args,
    );
    if (out.error !== undefined) throw new Error(out.error);
    return out.value as R;
  } finally {
    // `fn` may have closed the tab the driver was on.
    if ((await driver.getAllWindowHandles()).includes(back)) await driver.switchTo().window(back);
  }
}

/** Open `names` as tabs in the site window. The last one is active. */
export async function openPages(ff: Firefox, names: string[]): Promise<void> {
  const { driver, siteWindow } = ff;
  await driver.switchTo().window(siteWindow);
  for (const [i, n] of names.entries()) {
    // The first page replaces the window's about:blank tab, which savetab would close.
    if (i > 0) await driver.switchTo().newWindow('tab');
    await driver.get(`${SITE}/${n}`);
  }
}

/** Same code path as the toolbar icon, through the e2e-only hook, with the site window's active tab. */
export async function sendWindow(ff: Firefox, action = 'sendWindow'): Promise<void> {
  await evaluate(
    ff,
    async (a: string, site: string) => {
      const tab = (await browser.tabs.query({ active: true })).find((t) => t.url?.startsWith(site));
      const bg = (await browser.runtime.getBackgroundPage()) as any;
      await bg.savetabTest.sendTabs(a, tab);
    },
    action,
    SITE,
  );
}

async function urls(driver: WebDriver): Promise<Map<string, string>> {
  const back = await driver.getWindowHandle().catch(() => undefined);
  const out = new Map<string, string>();
  for (const h of await driver.getAllWindowHandles()) {
    await driver.switchTo().window(h);
    out.set(h, await driver.getCurrentUrl());
  }
  if (back) await driver.switchTo().window(back);
  return out;
}

/** Switch to the OneTab page once it is open. */
export async function onetabPage({ driver }: Firefox): Promise<void> {
  let handle: string | undefined;
  await expect
    .poll(async () => {
      handle = [...(await urls(driver))].find(([, u]) => u.startsWith(`${EXT}/onetab.html`))?.[0];
      return handle;
    })
    .toBeDefined();
  await driver.switchTo().window(handle!);
}

export async function openUrls({ driver }: Firefox): Promise<string[]> {
  return [...(await urls(driver)).values()].filter((u) => u.startsWith(SITE));
}

/** A page mounts its UI after `driver.get` returns, so a lookup waits for the element. */
export function find(driver: WebDriver, by: By): Promise<WebElement> {
  return driver.wait(until.elementLocated(by), 10_000);
}

export async function texts(driver: WebDriver, css: string): Promise<string[]> {
  return Promise.all((await driver.findElements(By.css(css))).map((e: WebElement) => e.getText()));
}

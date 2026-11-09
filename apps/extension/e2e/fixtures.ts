import { test as base, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

const EXTENSION = path.resolve(import.meta.dirname, '../.output/chrome-mv3-e2e');

// A real server, not context.route: tabs the extension opens in the background start
// loading before Playwright can attach request interception to them.
const server = createServer((req, res) => {
  const n = (req.url ?? '/').slice(1);
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<title>Page ${n}</title><h1>Page ${n}</h1>`);
}).listen(0, '127.0.0.1');
server.unref();
await new Promise((r) => server.once('listening', r));
export const SITE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

export const test = base.extend<{ context: BrowserContext; worker: Worker; extensionId: string }>({
  // Playwright requires an object pattern for the fixtures argument, even an empty one.
  // oxlint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    });
    await use(context);
    await context.close();
  },
  worker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },
  extensionId: async ({ worker }, use) => {
    await use(new URL(worker.url()).host);
  },
});

export const expect = test.expect;

/** Open `names` as tabs in the first window and return the page for the last one, which is active. */
export async function openPages(context: BrowserContext, names: string[]): Promise<Page> {
  let last: Page | undefined;
  for (const n of names) {
    last = await context.newPage();
    await last.goto(`${SITE}/${n}`);
  }
  for (const p of context.pages()) if (p.url() === 'about:blank') await p.close();
  await last!.bringToFront();
  return last!;
}

/** Same code path as the toolbar icon, through the e2e-only hook. */
export async function sendWindow(worker: Worker, action = 'sendWindow'): Promise<void> {
  await worker.evaluate(async (a) => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await (globalThis as any).savetabTest.sendTabs(a, tab);
  }, action);
}

export async function onetabPage(context: BrowserContext, extensionId: string): Promise<Page> {
  const url = `chrome-extension://${extensionId}/onetab.html`;
  const found = context.pages().find((p) => p.url().startsWith(url));
  if (found) return found;
  return context.waitForEvent('page', { predicate: (p) => p.url().startsWith(url) });
}

export function openUrls(context: BrowserContext): string[] {
  return context
    .pages()
    .map((p) => p.url())
    .filter((u) => u.startsWith(SITE));
}

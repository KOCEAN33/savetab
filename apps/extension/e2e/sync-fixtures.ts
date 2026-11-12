import type { BrowserContext, Page, Worker } from '@playwright/test';
import { test as base, expect, launchProfile, workerOf } from './fixtures';
import { startSyncServer } from './sync-server';

export interface Profile {
  context: BrowserContext;
  worker: Worker;
  list: Page;
}

async function profile(context: BrowserContext): Promise<Profile> {
  const worker = await workerOf(context);
  const list = await context.newPage();
  await list.goto(`chrome-extension://${new URL(worker.url()).host}/onetab.html`);
  return { context, worker, list };
}

/** Two browser profiles and a sync server that takes a login from either. */
export const test = base.extend<{ first: Profile; second: Profile; server: string }>({
  first: async ({ context }, use) => {
    await use(await profile(context));
  },
  // oxlint-disable-next-line no-empty-pattern
  second: async ({}, use) => {
    const context = await launchProfile();
    await use(await profile(context));
    await context.close();
  },
  server: [
    // Both profiles load the extension from one path, so they share its id and redirect URI.
    async ({ worker }, use) => {
      const server = await startSyncServer([await worker.evaluate(() => chrome.identity.getRedirectURL())]);
      await use(server.url);
      await server.stop();
    },
    { timeout: 120_000 },
  ],
});

export { expect };

/** Wait until the profile's list shows exactly `titles`. Each try runs a cycle, since the alarm that pulls fires once a minute. */
export async function expectTabs(p: Profile, titles: string[]): Promise<void> {
  await expect(async () => {
    await p.worker.evaluate(() => (globalThis as any).savetabTest.sync());
    await expect(p.list.locator('.tab-link')).toHaveText(titles, { timeout: 500 });
  }).toPass({ timeout: 15_000 });
}

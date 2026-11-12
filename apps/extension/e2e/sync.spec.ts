import type { BrowserContext, Page, Worker } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { test as base, expect, launchProfile, openPages, sendWindow, workerOf } from './fixtures';
import { logIn, startSyncServer } from './sync-server';

interface Profile {
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

const test = base.extend<{ first: Profile; second: Profile; server: string; dataKey: number[] }>({
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
    // oxlint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const server = await startSyncServer();
      await use(server.url);
      await server.stop();
    },
    { timeout: 120_000 },
  ],
  // oxlint-disable-next-line no-empty-pattern
  dataKey: async ({}, use) => {
    await use([...randomBytes(32)]);
  },
});

async function join(p: Profile, server: string, dataKey: number[], deviceName: string): Promise<void> {
  await p.worker.evaluate(
    ({ account, key }) => (globalThis as any).savetabTest.joinSync({ ...account, dataKey: new Uint8Array(key) }),
    { account: await logIn(server, deviceName), key: dataKey },
  );
}

/** Wait until the profile's list shows exactly `titles`. Each try runs a cycle, since the alarm that pulls fires once a minute. */
async function expectTabs(p: Profile, titles: string[]): Promise<void> {
  await expect(async () => {
    await p.worker.evaluate(() => (globalThis as any).savetabTest.sync());
    await expect(p.list.locator('.tab-link')).toHaveText(titles, { timeout: 500 });
  }).toPass({ timeout: 15_000 });
}

test('a tab stored in one profile shows in the other', async ({ first, second, server, dataKey }) => {
  await join(first, server, dataKey, 'first');
  await join(second, server, dataKey, 'second');

  await openPages(first.context, ['shared']);
  await sendWindow(first.worker);

  await expectTabs(second, ['Page shared']);
});

test('a device that joins uploads the tabs it already holds', async ({ first, second, server, dataKey }) => {
  await openPages(second.context, ['mine']);
  await sendWindow(second.worker);
  await expect(second.list.locator('.tab-link')).toHaveText(['Page mine']);

  await join(first, server, dataKey, 'first');
  await join(second, server, dataKey, 'second');

  await expectTabs(first, ['Page mine']);
});

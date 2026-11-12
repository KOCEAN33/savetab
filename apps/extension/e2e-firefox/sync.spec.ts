import { randomBytes } from 'node:crypto';
import { logIn } from '../e2e/sync-server';
import { EXT, evaluate, expect, onetabPage, openPages, sendWindow, texts, type Firefox } from './fixtures';
import { expectTabs, test as base } from './sync-fixtures';

const test = base.extend<{ dataKey: number[] }>({
  // oxlint-disable-next-line no-empty-pattern
  dataKey: async ({}, use) => {
    await use([...randomBytes(32)]);
  },
});

async function join(ff: Firefox, server: string, dataKey: number[], deviceName: string): Promise<void> {
  await evaluate(
    ff,
    async (account: object, key: number[]) => {
      const bg = (await browser.runtime.getBackgroundPage()) as any;
      // The key is built in the background's realm, where the sync code runs its type checks.
      await bg.savetabTest.joinSync({ ...account, dataKey: new bg.Uint8Array(key) });
    },
    await logIn(server, deviceName),
    dataKey,
  );
}

test('a tab stored in one profile shows in the other', async ({ ff: first, second, server, dataKey }) => {
  await join(first, server, dataKey, 'first');
  await join(second, server, dataKey, 'second');
  await second.driver.get(`${EXT}/onetab.html`);

  await openPages(first, ['shared']);
  await sendWindow(first);

  await expectTabs(second, ['Page shared']);
});

test('a device that joins uploads the tabs it already holds', async ({ ff: first, second, server, dataKey }) => {
  await openPages(second, ['mine']);
  await sendWindow(second);
  await onetabPage(second);
  await expect.poll(() => texts(second.driver, '.tab-link')).toEqual(['Page mine']);
  await first.driver.get(`${EXT}/onetab.html`);

  await join(first, server, dataKey, 'first');
  await join(second, server, dataKey, 'second');

  await expectTabs(first, ['Page mine']);
});

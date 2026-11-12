import { startSyncServer } from '../e2e/sync-server';
import { evaluate, expect, test as base, texts, withFirefox, type Firefox } from './fixtures';

/** Two Firefox profiles and a sync server that takes a login from either. */
export const test = base.extend<{ second: Firefox; server: string }>({
  // oxlint-disable-next-line no-empty-pattern
  second: async ({}, use) => {
    await withFirefox(use);
  },
  // The redirect URI comes from the add-on id, so both profiles share it.
  server: async ({ ff }, use) => {
    const server = await startSyncServer([await evaluate(ff, async () => browser.identity.getRedirectURL())]);
    await use(server.url);
    await server.stop();
  },
});

/** Wait until the profile's list, the page its driver is on, shows exactly `titles`. Each try runs a cycle, since the alarm that pulls fires once a minute. */
export async function expectTabs(ff: Firefox, titles: string[]): Promise<void> {
  await expect
    .poll(
      async () => {
        await evaluate(ff, async () => {
          const bg = (await browser.runtime.getBackgroundPage()) as any;
          await bg.savetabTest.sync();
        });
        return texts(ff.driver, '.tab-link');
      },
      { timeout: 15_000 },
    )
    .toEqual(titles);
}

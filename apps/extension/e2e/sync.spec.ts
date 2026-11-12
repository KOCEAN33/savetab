import { randomBytes } from 'node:crypto';
import { openPages, sendWindow } from './fixtures';
import { test as base, expect, expectTabs, type Profile } from './sync-fixtures';
import { logIn, pushOps, snapshotSeq } from './sync-server';

const test = base.extend<{ dataKey: number[] }>({
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

test('a device that joins after a snapshot reads the list from it', async ({ first, second, server, dataKey }) => {
  await join(first, server, dataKey, 'first');
  const third = await logIn(server, 'third');
  await pushOps(third, dataKey, 'Page old', 5000);

  await expectTabs(first, ['Page old']);
  await expect.poll(() => snapshotSeq(third)).toBeGreaterThanOrEqual(5000);

  await join(second, server, dataKey, 'second');
  await expectTabs(second, ['Page old']);
});

test('a shared group opens as a web page until sharing stops', async ({ first, server, dataKey }) => {
  await join(first, server, dataKey, 'first');
  await openPages(first.context, ['a', 'b']);
  await sendWindow(first.worker);
  const { list, context } = first;
  await expect(list.locator('.tab-link')).toHaveText(['Page a', 'Page b']);
  const stored = await list.locator('.tab-link').evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).href));

  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await list.bringToFront();
  await list.getByRole('button', { name: 'More…' }).click();
  await list.getByRole('menuitem', { name: 'Share as a web page' }).click();
  await expect(list.locator('.group-head .meta')).toContainText('Shared until');
  const url = await list.evaluate(() => navigator.clipboard.readText());
  expect(url).toMatch(new RegExp(`^${server}/s/[0-9a-f-]{36}#[A-Za-z0-9_-]{43}$`));

  const shared = await context.newPage();
  await shared.goto(url);
  await expect(shared.locator('a.link')).toHaveText(['Page a', 'Page b']);
  expect(await shared.locator('a.link').evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).href))).toEqual(stored);

  await list.bringToFront();
  await list.getByRole('button', { name: 'More…' }).click();
  await list.getByRole('menuitem', { name: 'Stop sharing' }).click();
  await expect(list.locator('.group-head .meta')).not.toContainText('Shared until');
  await shared.reload();
  await expect(shared.locator('p.message')).toHaveText('This shared page does not exist or has expired.');
  await expect(shared.locator('a.link')).toHaveCount(0);
});

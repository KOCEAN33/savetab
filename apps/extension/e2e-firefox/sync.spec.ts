import { randomBytes } from 'node:crypto';
import { logIn, pushOps, snapshotSeq } from '../e2e/sync-server';
import { By } from 'selenium-webdriver';
import { EXT, evaluate, expect, find, onetabPage, openPages, sendWindow, texts, type Firefox } from './fixtures';
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

test('a device that joins after a snapshot reads the list from it', async ({ ff: first, second, server, dataKey }) => {
  await join(first, server, dataKey, 'first');
  await first.driver.get(`${EXT}/onetab.html`);
  const third = await logIn(server, 'third');
  await pushOps(third, dataKey, 'Page old', 5000);

  await expectTabs(first, ['Page old']);
  await expect.poll(() => snapshotSeq(third)).toBeGreaterThanOrEqual(5000);

  await join(second, server, dataKey, 'second');
  await second.driver.get(`${EXT}/onetab.html`);
  await expectTabs(second, ['Page old']);
});

const menuItem = (name: string) => By.xpath(`//button[@role='menuitem'][normalize-space()='${name}']`);

// Chromium's e2e reads the copied URL from the clipboard. WebDriver cannot read Firefox's, so this
// one builds the URL from the share the group's record holds.
test('a shared group opens as a web page until sharing stops', async ({ ff, server, dataKey }) => {
  const { driver } = ff;
  await join(ff, server, dataKey, 'first');
  await openPages(ff, ['a', 'b']);
  await sendWindow(ff);
  await onetabPage(ff);
  const list = await driver.getWindowHandle();
  await expect.poll(() => texts(driver, '.tab-link')).toEqual(['Page a', 'Page b']);
  const meta = async () => (await texts(driver, '.group-head .meta')).join();

  await (await find(driver, By.css('.group-head button[title="More…"]'))).click();
  await (await find(driver, menuItem('Share as a web page'))).click();
  await expect.poll(meta).toContain('Shared until');
  const share = await evaluate(
    ff,
    () =>
      new Promise<{ id: string; key: string }>((resolve, reject) => {
        const open = indexedDB.open('savetab');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const all = open.result.transaction('items').objectStore('items').getAll();
          all.onsuccess = () => resolve(all.result.find((r) => r.share).share);
        };
      }),
  );

  await driver.switchTo().newWindow('tab');
  const shared = await driver.getWindowHandle();
  await driver.get(`${server}/s/${share.id}#${share.key}`);
  await expect.poll(() => texts(driver, 'a.link')).toEqual(['Page a', 'Page b']);

  await driver.switchTo().window(list);
  await (await find(driver, By.css('.group-head button[title="More…"]'))).click();
  await (await find(driver, menuItem('Stop sharing'))).click();
  await expect.poll(meta).not.toContain('Shared until');
  await driver.switchTo().window(shared);
  await driver.navigate().refresh();
  await expect.poll(() => texts(driver, 'p.message')).toEqual(['This shared page does not exist or has expired.']);
  expect(await texts(driver, 'a.link')).toEqual([]);
});

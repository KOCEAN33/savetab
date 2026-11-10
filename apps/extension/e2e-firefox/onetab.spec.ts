import { By } from 'selenium-webdriver';
import { evaluate, expect, onetabPage, openPages, openUrls, sendWindow, SITE, test, texts } from './fixtures';

test('the toolbar action stores the open tabs, closes them, and shows the total', async ({ ff }) => {
  await openPages(ff, ['1', '2', '3']);
  await sendWindow(ff);
  await onetabPage(ff);

  await expect.poll(() => texts(ff.driver, '.page-total')).toEqual(['Total: 3 tabs']);
  expect(await texts(ff.driver, '.tab-link')).toEqual(['Page 1', 'Page 2', 'Page 3']);
  expect(await openUrls(ff)).toEqual([]);
});

test('clicking a stored title reopens that site and the total drops by one', async ({ ff }) => {
  await openPages(ff, ['1', '2', '3']);
  await sendWindow(ff);
  await onetabPage(ff);
  await expect.poll(() => texts(ff.driver, '.page-total')).toEqual(['Total: 3 tabs']);

  await ff.driver.findElement(By.linkText('Page 1')).click();
  await expect.poll(() => openUrls(ff)).toEqual([`${SITE}/1`]);
  await expect.poll(() => texts(ff.driver, '.page-total')).toEqual(['Total: 2 tabs']);
  expect(await texts(ff.driver, '.tab-link')).toEqual(['Page 2', 'Page 3']);
});

test('keeps pinned tabs open and out of the list', async ({ ff }) => {
  await openPages(ff, ['pinned', 'a', 'b']);
  await evaluate(
    ff,
    async (url: string) => {
      // In Firefox a `url` query for the local server, whose URL has a port, finds no tab.
      const t = (await browser.tabs.query({})).find((x) => x.url === url);
      await browser.tabs.update(t!.id!, { pinned: true });
    },
    `${SITE}/pinned`,
  );
  await sendWindow(ff);
  await onetabPage(ff);

  await expect.poll(() => texts(ff.driver, '.tab-link')).toEqual(['Page a', 'Page b']);
  expect(await openUrls(ff)).toEqual([`${SITE}/pinned`]);
});

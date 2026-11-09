import { expect, onetabPage, openPages, sendWindow, test } from './fixtures';

test('the Korean language setting translates the page total and the group menu', async ({
  context,
  worker,
  extensionId,
}) => {
  await openPages(context, ['k1', 'k2']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);
  await expect(list.locator('.page-total')).toHaveText('Total: 2 tabs');

  // The page reloads itself when the device language changes.
  await worker.evaluate(() => chrome.storage.local.set({ deviceSettings: { language: 'ko' } }));
  await expect(list.locator('.page-total')).toHaveText('전체: 탭 2개');
  await expect(list.locator('html')).toHaveAttribute('lang', 'ko');

  await list.locator('.group').first().getByRole('button', { name: '더 보기…' }).click();
  await expect(list.getByRole('menuitem', { name: '이름 바꾸기' })).toBeVisible();
});

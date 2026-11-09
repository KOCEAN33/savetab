import { expect, onetabPage, openPages, openUrls, sendWindow, SITE, test } from './fixtures';

test('"Send this tab to" lists a renamed group and sends the active tab into it', async ({
  context,
  worker,
  extensionId,
}) => {
  await openPages(context, ['s1', 's2']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);
  await list.locator('.group-label').click();
  await list.locator('.group-title-input').fill('Reading');
  await list.keyboard.press('Enter');
  const groupId = await list.locator('.group-head').getAttribute('data-id');

  // The menu rebuilds on its own once the title change lands.
  await expect
    .poll(() => worker.evaluate(() => (globalThis as any).savetabTest.sendTargets()))
    .toEqual([{ id: groupId, title: 'Reading' }]);

  await openPages(context, ['s3']);
  await worker.evaluate(async (id) => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await (globalThis as any).savetabTest.onMenuClick({ menuItemId: `send-to:${id}` }, tab);
  }, groupId);

  await list.bringToFront();
  await expect(list.locator('.tab-link')).toHaveText(['Page s3', 'Page s1', 'Page s2']);
  expect(openUrls(context)).not.toContain(`${SITE}/s3`);
});

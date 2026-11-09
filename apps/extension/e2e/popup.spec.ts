import { expect, onetabPage, openPages, SITE, test } from './fixtures';

test('the send popup stores the ticked tabs into a named group and closes them', async ({
  context,
  worker,
  extensionId,
}) => {
  await openPages(context, ['s1']);
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await (globalThis as any).savetabTest.sendTabs('sendWindow', tab);
  });
  const list = await onetabPage(context, extensionId);
  await list.locator('.group').first().getByRole('button', { name: '1 tab', exact: true }).click();
  await list.locator('.group-title-input').fill('Later');
  await list.keyboard.press('Enter');

  await openPages(context, ['p1', 'p2', 'p3']);
  const windowId = await worker.evaluate(async () => (await chrome.windows.getLastFocused()).id);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/send.html?window=${windowId}`);

  await popup.getByRole('checkbox', { name: 'Page p2' }).uncheck();
  await popup.getByRole('radio', { name: 'Existing group' }).check();
  await popup.getByRole('searchbox', { name: 'Find a group' }).fill('Lat');
  await popup.getByRole('listbox', { name: 'Group' }).selectOption({ label: 'Later' });
  await popup.getByRole('button', { name: 'Send 2 tabs' }).click();
  await expect(popup.getByRole('status')).toHaveText('Stored 2 tabs.');

  await list.bringToFront();
  await expect(list.locator('.group').first().locator('.tab-link')).toHaveText(['Page p1', 'Page p3', 'Page s1']);
  await expect.poll(() => context.pages().map((p) => p.url()).filter((u) => u.startsWith(SITE))).toEqual([`${SITE}/p2`]);
});

test('the toolbar icon opens the send popup only with the popup toolbar action', async ({ worker, extensionId }) => {
  const popup = () => worker.evaluate(() => chrome.action.getPopup({}));
  await expect.poll(popup).toBe('');
  await worker.evaluate(() => chrome.storage.local.set({ deviceSettings: { toolbarAction: 'popup' } }));
  await expect.poll(popup).toBe(`chrome-extension://${extensionId}/send.html`);
  await worker.evaluate(() => chrome.storage.local.set({ deviceSettings: { toolbarAction: 'sendWindow' } }));
  await expect.poll(popup).toBe('');
});

import { expect, onetabPage, openPages, sendWindow, test } from './fixtures';

test('a note added to one tab shows on every copy of its URL', async ({ context, worker, extensionId }) => {
  await openPages(context, ['n1']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);
  await openPages(context, ['n1', 'n2']);
  await sendWindow(worker);
  await list.bringToFront();
  await expect(list.locator('.group')).toHaveCount(2);

  const first = list.locator('.tab').filter({ hasText: 'Page n1' }).first();
  await first.hover();
  await first.getByRole('button', { name: 'More actions for Page n1' }).click();
  await list.getByRole('menuitem', { name: 'Add note' }).click();
  await list.getByRole('textbox', { name: 'Note' }).fill('read before Friday');
  await list.keyboard.press('ControlOrMeta+Enter');

  await expect(list.locator('.tab').filter({ hasText: 'Page n1' }).locator('.tab-notes')).toHaveText([
    'read before Friday',
    'read before Friday',
  ]);
});

test('renaming a tab renames every copy', async ({
  context,
  worker,
  extensionId,
}) => {
  await openPages(context, ['r1']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);
  await openPages(context, ['r1']);
  await sendWindow(worker);
  await list.bringToFront();

  const row = list.locator('.tab').first();
  await row.hover();
  await row.getByRole('button', { name: 'More actions for Page r1' }).click();
  await list.getByRole('menuitem', { name: 'Rename' }).click();
  await list.getByRole('textbox', { name: 'Tab title' }).fill('Renamed');
  await list.keyboard.press('Enter');
  await expect(list.locator('.tab-link')).toHaveText(['Renamed', 'Renamed']);
});

test('a tab’s menu opens it in a new window', async ({ context, worker, extensionId }) => {
  await openPages(context, ['w1', 'w2']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);
  const windows = () => worker.evaluate(async () => (await chrome.windows.getAll()).length);
  const before = await windows();

  const row = list.locator('.tab').filter({ hasText: 'Page w1' });
  await row.hover();
  await row.getByRole('button', { name: 'More actions for Page w1' }).click();
  await list.getByRole('menuitem', { name: 'Open in a new window' }).click();
  await expect.poll(windows).toBe(before + 1);
});

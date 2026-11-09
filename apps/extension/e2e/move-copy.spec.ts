import { drag, expect, onetabPage, openPages, sendWindow, test } from './fixtures';

test('moves a group into a folder through the Move dialog', async ({ context, worker, extensionId }) => {
  await openPages(context, ['m1', 'm2']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);
  const main = list.getByRole('main');
  await main.getByRole('button', { name: 'New folder' }).click();
  await list.getByRole('textbox', { name: 'Folder name' }).fill('Archive');
  await list.keyboard.press('Enter');

  await main.locator('section[aria-label="2 tabs"]').getByRole('button', { name: 'More…' }).click();
  await list.getByRole('menuitem', { name: 'Move…' }).click();
  const dialog = list.getByRole('dialog', { name: 'Move to' });
  await dialog.getByRole('textbox', { name: 'Find a location' }).fill('arch');
  await expect(dialog.getByRole('button')).toHaveText(['Archive', 'Cancel']);
  await dialog.getByRole('button', { name: 'Archive' }).click();

  await expect(main.locator('section[aria-label="2 tabs"]')).toHaveCount(0);
  await expect(main.locator('section[aria-label="Folder Archive"]')).toContainText('Folder, 2 tabs');
});

test('dropping a group on another group in the folder column merges them', async ({ context, worker, extensionId }) => {
  await openPages(context, ['a1', 'a2']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);
  await openPages(context, ['b1']);
  await sendWindow(worker);
  await list.bringToFront();

  const groups = list.locator('main .group');
  await expect(groups).toHaveCount(2);
  const nav = list.getByRole('navigation', { name: 'Folders' });
  await drag(list, groups.nth(0).locator('.group-grip'), nav.getByRole('button', { name: '2 tabs', exact: true }), 4);
  await expect(list.locator('main .group')).toHaveCount(1);
  await expect(list.locator('.tab-link')).toHaveText(['Page a1', 'Page a2', 'Page b1']);
});

test('dragging a tab with Alt held copies it', async ({ context, worker, extensionId }) => {
  await openPages(context, ['c1', 'c2']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);
  await openPages(context, ['d1']);
  await sendWindow(worker);
  await list.bringToFront();

  const groups = list.locator('main .group');
  await list.keyboard.down('Alt');
  await drag(
    list,
    groups.nth(0).getByRole('link', { name: 'Page d1' }),
    groups.nth(1).getByRole('link', { name: 'Page c2' }),
  );
  await list.keyboard.up('Alt');
  await expect(groups.nth(0).locator('.tab-link')).toHaveText(['Page d1']);
  await expect(groups.nth(1).locator('.tab-link')).toHaveText(['Page c1', 'Page d1', 'Page c2']);
});

import { drag, expect, onetabPage, openPages, sendWindow, test } from './fixtures';

test('makes a folder, drags a group into it, opens it, and returns through the breadcrumb', async ({
  context,
  worker,
  extensionId,
}) => {
  await openPages(context, ['f1', 'f2']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);
  const main = list.getByRole('main');

  await main.getByRole('button', { name: 'New folder' }).click();
  await list.getByRole('textbox', { name: 'Folder name' }).fill('Work');
  await list.keyboard.press('Enter');
  const nav = list.getByRole('navigation', { name: 'Folders' });
  await expect(nav.getByRole('button', { name: 'Work', exact: true })).toBeVisible();

  const group = main.locator('section[aria-label="2 tabs"]');
  await drag(list, group.locator('.group-grip'), nav.getByRole('button', { name: 'Work', exact: true }), 4);
  await expect(main.locator('section[aria-label="2 tabs"]')).toHaveCount(0);
  await expect(main.locator('section[aria-label="Folder Work"]')).toContainText('Folder, 2 tabs');

  await main.getByRole('button', { name: 'Work', exact: true }).click();
  await expect(main.locator('.tab-link')).toHaveText(['Page f1', 'Page f2']);
  await expect(list.getByRole('heading', { name: 'Total: 2 tabs' })).toBeVisible();

  await main.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button', { name: 'All tabs' }).click();
  await expect(main.locator('section[aria-label="Folder Work"]')).toBeVisible();
  await expect(main.locator('.tab-link')).toHaveCount(0);
});

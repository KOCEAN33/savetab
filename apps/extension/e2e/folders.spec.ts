import { drag, expect, onetabPage, openPages, sendWindow, test } from './fixtures';

test('makes a folder, drags a group onto its chip, opens it, and returns through the All tabs chip', async ({
  context,
  worker,
  extensionId,
}) => {
  await openPages(context, ['f1', 'f2']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);
  const main = list.getByRole('main');
  const nav = main.getByRole('navigation', { name: 'Folders' });
  const allTabs = nav.getByRole('button', { name: 'All tabs' });
  const work = nav.getByRole('button', { name: 'Work', exact: true });

  await nav.getByRole('button', { name: 'New folder' }).click();
  await list.getByRole('textbox', { name: 'Folder name' }).fill('Work');
  await list.keyboard.press('Enter');
  await expect(work).toBeVisible();
  await expect(allTabs).toHaveAttribute('aria-current', 'page');

  const group = main.locator('section[aria-label="2 tabs"]');
  await drag(list, group.getByLabel('Drag 2 tabs'), work, 4);
  await expect(main.locator('section[aria-label="2 tabs"]')).toHaveCount(0);
  await expect(main.locator('.tab-link')).toHaveCount(0);
  await expect(main.getByRole('treeitem', { name: /Work/ })).toHaveCount(0);
  await expect(list.getByRole('heading', { name: 'Total: 2 tabs' })).toBeVisible();

  await work.click();
  await expect(work).toHaveAttribute('aria-current', 'page');
  await expect(main.locator('.tab-link')).toHaveText(['Page f1', 'Page f2']);
  await expect(list.getByRole('heading', { name: 'Total: 2 tabs' })).toBeVisible();

  await allTabs.click();
  await expect(allTabs).toHaveAttribute('aria-current', 'page');
  await expect(work).toBeVisible();
  await expect(main.locator('.tab-link')).toHaveCount(0);
});

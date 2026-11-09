import { expect, onetabPage, openPages, openUrls, sendWindow, SITE, test } from './fixtures';

test('keys move between rows, fold a group, and open a tab', async ({ context, worker, extensionId }) => {
  await openPages(context, ['k1', 'k2']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);
  const main = list.getByRole('main');

  // Tab from the control just above the list lands on the first row.
  await main.getByRole('combobox', { name: 'Sort groups' }).focus();
  await list.keyboard.press('Tab');
  const head = main.getByRole('treeitem', { name: '2 tabs' });
  await expect(head).toBeFocused();

  await list.keyboard.press('ArrowLeft');
  await expect(main.locator('.tab-link')).toHaveCount(0);
  await list.keyboard.press('ArrowRight');
  await expect(main.locator('.tab-link')).toHaveCount(2);

  await list.keyboard.press('ArrowDown');
  await list.keyboard.press('ArrowDown');
  await expect(main.locator('li.tab').nth(1)).toBeFocused();
  await list.keyboard.press('ArrowUp');
  await expect(main.locator('li.tab').nth(0)).toBeFocused();
  await list.keyboard.press('ArrowLeft');
  await expect(head).toBeFocused();

  await list.keyboard.press('ArrowDown');
  await list.keyboard.press('Enter');
  await expect.poll(() => openUrls(context)).toEqual([`${SITE}/k1`]);
  await list.bringToFront();
  await expect(main.locator('.tab-link')).toHaveText(['Page k2']);

  await main.locator('li.tab').first().focus();
  await list.keyboard.press('Escape');
  await expect(main.locator('li.tab').first()).not.toBeFocused();
});

test('Backspace goes to the parent folder, / and Alt+/ focus search', async ({ context, worker, extensionId }) => {
  await openPages(context, ['p1']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);
  const main = list.getByRole('main');
  await main.getByRole('button', { name: 'New folder' }).click();
  await list.getByRole('textbox', { name: 'Folder name' }).fill('Outer');
  await list.keyboard.press('Enter');
  await main.getByRole('button', { name: 'Outer', exact: true }).click();
  await main.getByRole('button', { name: 'New folder' }).click();
  await list.getByRole('textbox', { name: 'Folder name' }).fill('Inner');
  await list.keyboard.press('Enter');

  await main.getByRole('treeitem', { name: 'Folder Inner' }).focus();
  await list.keyboard.press('Backspace');
  await expect(main.getByRole('treeitem', { name: 'Folder Outer' })).toBeVisible();

  await main.getByRole('button', { name: 'Outer', exact: true }).click();
  await main.getByRole('treeitem', { name: 'Folder Inner' }).focus();
  await list.keyboard.press('Alt+Slash');
  await expect(list.getByRole('searchbox', { name: 'Search' })).toBeFocused();
  await list.getByRole('button', { name: 'Filters' }).click();
  await expect(list.getByRole('combobox', { name: 'In folder' })).toHaveValue(/.+/);

  await list.locator('body').click({ position: { x: 5, y: 5 } });
  await list.keyboard.press('/');
  await expect(list.getByRole('searchbox', { name: 'Search' })).toBeFocused();
});

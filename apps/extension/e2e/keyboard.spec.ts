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
  const nav = main.getByRole('navigation', { name: 'Folders' });
  const outer = nav.getByRole('button', { name: 'Outer', exact: true });
  const inner = nav.getByRole('button', { name: 'Inner', exact: true });
  await nav.getByRole('button', { name: 'New folder' }).click();
  await list.getByRole('textbox', { name: 'Folder name' }).fill('Outer');
  await list.keyboard.press('Enter');
  await outer.click();
  await nav.getByRole('button', { name: 'New folder' }).click();
  await list.getByRole('textbox', { name: 'Folder name' }).fill('Inner');
  await list.keyboard.press('Enter');

  // A folder has no row of its own, so a group inside Inner gives the keys a row to start from.
  await nav.getByRole('button', { name: 'All tabs' }).click();
  await main.locator('section[aria-label="1 tab"]').getByRole('button', { name: 'More…' }).click();
  await list.getByRole('menuitem', { name: 'Move…' }).click();
  const dialog = list.getByRole('dialog', { name: 'Move to' });
  await dialog.getByRole('textbox', { name: 'Find a location' }).fill('inner');
  await dialog.getByRole('button', { name: 'Inner' }).click();
  await expect(main.locator('.tab-link')).toHaveCount(0);

  await outer.click();
  await inner.click();
  await expect(inner).toHaveAttribute('aria-current', 'page');
  await main.getByRole('treeitem', { name: '1 tab' }).focus();
  await list.keyboard.press('Backspace');
  await expect(outer).toHaveAttribute('aria-current', 'page');
  await expect(inner).not.toHaveAttribute('aria-current', 'page');

  await inner.click();
  await main.getByRole('treeitem', { name: '1 tab' }).focus();
  await list.keyboard.press('Alt+Slash');
  await expect(list.getByRole('searchbox', { name: 'Search' })).toBeFocused();
  await list.getByRole('button', { name: 'Filters' }).click();
  await expect(list.getByRole('combobox', { name: 'In folder' }).locator('option:checked')).toHaveText(/Inner/);

  await list.locator('body').click({ position: { x: 5, y: 5 } });
  await list.keyboard.press('/');
  await expect(list.getByRole('searchbox', { name: 'Search' })).toBeFocused();
});

import { expect, onetabPage, openPages, sendWindow, test } from './fixtures';

test('collapse hides a group’s tabs and expand brings them back', async ({ context, worker, extensionId }) => {
  await openPages(context, ['k1', 'k2']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);
  const group = list.locator('main .group').first();
  await group.getByRole('button', { name: 'Collapse' }).click();
  await expect(group.locator('.tab-link')).toHaveCount(0);
  await group.getByRole('button', { name: 'Expand' }).click();
  await expect(group.locator('.tab-link')).toHaveText(['Page k1', 'Page k2']);
});

test('pages a long folder, and sorts groups A-Z', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/import-export.html`);
  const text = Array.from({ length: 52 }, (_, i) => `https://g${i}.example/ | G${String(i).padStart(2, '0')}`).join(
    '\n\n',
  );
  await page.getByRole('textbox', { name: 'Links to import' }).fill(text);
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByRole('status')).toHaveText('Imported 52 tabs in 52 groups.');

  await page.goto(`chrome-extension://${extensionId}/onetab.html`);
  const main = page.getByRole('main');
  await expect(main.locator('.group')).toHaveCount(50);
  await expect(main.locator('.tab-link').first()).toHaveText('G00');
  await main.getByRole('button', { name: 'Next 2' }).click();
  await expect(main.locator('.tab-link')).toHaveText(['G50', 'G51']);
  await main.getByRole('button', { name: 'Previous 50' }).click();
  await expect(main.locator('.group')).toHaveCount(50);

  // Imported groups are unnamed, so name two and sort by name.
  for (const [i, name] of [
    [0, 'zebra'],
    [1, 'Apple'],
  ] as const) {
    await main.locator('.group').nth(i).getByRole('button', { name: 'More…' }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    await page.getByRole('textbox', { name: 'Group name' }).fill(name);
    await page.keyboard.press('Enter');
  }
  await main.getByRole('combobox', { name: 'Sort groups' }).selectOption('A-Z');
  await expect(main.locator('.group-label').first()).toHaveText('1 tab');
  await main.getByRole('combobox', { name: 'Sort groups' }).selectOption('Z-A');
  await expect(main.locator('.group-label').first()).toHaveText('zebra');
  await expect(main.locator('.group-label').nth(1)).toHaveText('Apple');
});

import { drag, expect, onetabPage, openPages, openUrls, sendWindow, SITE, test } from './fixtures';

test('stores a window of 5 tabs as one group and closes them', async ({ context, worker, extensionId }) => {
  await openPages(context, ['1', '2', '3', '4', '5']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);

  await expect(list.getByRole('heading', { name: 'Total: 5 tabs' })).toBeVisible();
  await expect(list.getByRole('main').getByRole('button', { name: '5 tabs', exact: true })).toBeVisible();
  await expect(list.locator('.tab-link')).toHaveText(['Page 1', 'Page 2', 'Page 3', 'Page 4', 'Page 5']);
  expect(openUrls(context)).toEqual([]);
});

test('keeps pinned tabs open and out of the list', async ({ context, worker, extensionId }) => {
  await openPages(context, ['pinned', 'a', 'b']);
  await worker.evaluate(async (site) => {
    const [t] = await chrome.tabs.query({ url: `${site}/pinned` });
    await chrome.tabs.update(t!.id!, { pinned: true });
  }, SITE);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);

  await expect(list.locator('.tab-link')).toHaveText(['Page a', 'Page b']);
  expect(openUrls(context)).toEqual([`${SITE}/pinned`]);
});

test('restoring a tab removes it, a middle click keeps it, Restore all empties the group', async ({
  context,
  worker,
  extensionId,
}) => {
  await openPages(context, ['1', '2', '3']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);
  await expect(list.locator('.tab-link')).toHaveCount(3);

  await list.getByRole('link', { name: 'Page 1' }).click();
  await expect.poll(() => openUrls(context)).toEqual([`${SITE}/1`]);
  await list.bringToFront();
  await expect(list.locator('.tab-link')).toHaveText(['Page 2', 'Page 3']);

  await list.getByRole('link', { name: 'Page 2' }).click({ button: 'middle' });
  await expect.poll(() => openUrls(context).sort()).toEqual([`${SITE}/1`, `${SITE}/2`]);
  await expect(list.locator('.tab-link')).toHaveText(['Page 2', 'Page 3']);

  await list.getByRole('button', { name: 'Restore all' }).click();
  await expect.poll(() => openUrls(context).sort()).toEqual([`${SITE}/1`, `${SITE}/2`, `${SITE}/2`, `${SITE}/3`]);
  await expect(list.getByRole('heading', { name: 'Total: 0 tabs' })).toBeVisible();
});

test('a locked group keeps restored tabs and hides delete', async ({ context, worker, extensionId }) => {
  await openPages(context, ['x', 'y']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);

  await list.getByRole('button', { name: 'More…' }).click();
  await list.getByRole('menuitem', { name: 'Lock this tab group' }).click();
  await expect(list.getByRole('button', { name: 'Delete all' })).toHaveCount(0);

  await list.getByRole('link', { name: 'Page x' }).click();
  await expect.poll(() => openUrls(context)).toEqual([`${SITE}/x`]);
  await list.bringToFront();
  await expect(list.locator('.tab-link')).toHaveText(['Page x', 'Page y']);
  await expect(list.locator('.tab-delete')).toHaveCount(0);
});

test('renames a group by clicking its label', async ({ context, worker, extensionId }) => {
  await openPages(context, ['r1', 'r2']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);

  await list.getByRole('main').getByRole('button', { name: '2 tabs', exact: true }).click();
  await list.locator('.group-title-input').fill('Reading');
  await list.keyboard.press('Enter');
  await expect(list.getByRole('main').getByRole('button', { name: 'Reading', exact: true })).toBeVisible();
});

test('drags a tab into another group', async ({ context, worker, extensionId }) => {
  await openPages(context, ['a1', 'a2']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);
  await openPages(context, ['b1']);
  await sendWindow(worker);
  await list.bringToFront();

  const groups = list.locator('.group');
  await expect(groups).toHaveCount(2);
  await drag(
    list,
    groups.nth(0).getByRole('link', { name: 'Page b1' }),
    groups.nth(1).getByRole('link', { name: 'Page a2' }),
  );

  await expect(list.locator('.group')).toHaveCount(1);
  await expect(list.locator('.tab-link')).toHaveText(['Page a1', 'Page b1', 'Page a2']);
});

test('dragging a ticked tab carries the other ticked tabs with it', async ({ context, worker, extensionId }) => {
  await openPages(context, ['a1', 'a2']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);
  await openPages(context, ['c1', 'c2', 'c3']);
  await sendWindow(worker);
  await list.bringToFront();

  const groups = list.locator('.group');
  await expect(groups).toHaveCount(2);
  // A tick shows on hover until something is ticked.
  await list.locator('.tab').filter({ hasText: 'Page c1' }).hover();
  await list.getByRole('checkbox', { name: 'Select Page c1' }).check();
  await list.getByRole('checkbox', { name: 'Select Page c3' }).check();
  await drag(
    list,
    groups.nth(0).getByRole('link', { name: 'Page c1' }),
    groups.nth(1).getByRole('link', { name: 'Page a2' }),
  );

  await expect(groups.nth(0).locator('.tab-link')).toHaveText(['Page c2']);
  await expect(groups.nth(1).locator('.tab-link')).toHaveText(['Page a1', 'Page c1', 'Page c3', 'Page a2']);
  await expect(list.getByRole('toolbar', { name: 'Selection' })).toHaveCount(0);
});

test('imports "URL | Title" text and exports it back', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/import-export.html`);
  const text = 'https://a.example/ | A\nhttps://b.example/\n\nhttps://c.example/ | C\n';
  await page.getByRole('textbox', { name: 'Links to import' }).fill(text);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('status').first()).toHaveText('Imported 3 tabs in 2 groups.');
  await expect(page.getByRole('textbox', { name: 'Exported links' })).toHaveValue(text);
});

test('Remove duplicates in the list head keeps one copy of each URL across groups', async ({ context, worker, extensionId }) => {
  await openPages(context, ['u1', 'u2']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);
  await openPages(context, ['u1']);
  await sendWindow(worker);
  await list.bringToFront();
  await expect(list.getByRole('heading', { name: 'Total: 3 tabs' })).toBeVisible();

  await list.getByRole('button', { name: 'Remove duplicates', exact: true }).click();
  await expect(list.getByRole('heading', { name: 'Total: 2 tabs' })).toBeVisible();
  await expect(list.locator('.tab-link')).toHaveText(['Page u1', 'Page u2']);
});

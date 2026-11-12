import { expect, onetabPage, openPages, openUrls, sendWindow, test } from './fixtures';

test('right-click on a tick selects all, and the bar moves the selection to trash', async ({
  context,
  worker,
  extensionId,
}) => {
  await openPages(context, ['s1', 's2']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);
  await openPages(context, ['s3']);
  await sendWindow(worker);
  await list.bringToFront();

  const row = list.locator('.tab').filter({ hasText: 'Page s3' });
  await row.hover();
  await row.getByRole('checkbox', { name: 'Select Page s3' }).click({ button: 'right' });
  await list.getByRole('menuitem', { name: 'Select all', exact: true }).click();
  const bar = list.getByRole('toolbar', { name: 'Selection' });
  await expect(bar).toContainText('5 selected');

  await list.getByRole('checkbox', { name: 'Select Page s1' }).uncheck();
  await expect(bar).toContainText('4 selected');
  await list.getByRole('checkbox', { name: 'Select Page s1' }).check();

  await bar.getByRole('button', { name: 'Move to trash' }).click();
  await expect(list.getByRole('heading', { name: 'Total: 0 tabs' })).toBeVisible();
  await expect(bar).toHaveCount(0);
});

test('Select this and below picks the clicked row and the rows under it', async ({ context, worker, extensionId }) => {
  await openPages(context, ['t1', 't2', 't3']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);

  const row = list.locator('.tab').filter({ hasText: 'Page t2' });
  await row.hover();
  await row.getByRole('checkbox', { name: 'Select Page t2' }).click({ button: 'right' });
  await list.getByRole('menuitem', { name: 'Select this and below' }).click();
  await expect(list.getByRole('checkbox', { name: /^Select Page/, checked: true })).toHaveCount(2);
  await expect(list.getByRole('checkbox', { name: 'Select Page t1' })).not.toBeChecked();
});

test('Ctrl/Cmd-click ticks a row without opening it, and Shift-click ticks the range', async ({ context, worker, extensionId }) => {
  await openPages(context, ['r1', 'r2', 'r3', 'r4']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);
  const box = (name: string) => list.getByRole('checkbox', { name: `Select Page ${name}` });

  await list.getByRole('link', { name: 'Page r2' }).click({ modifiers: ['ControlOrMeta'] });
  await expect(box('r2')).toBeChecked();
  await list.getByRole('link', { name: 'Page r2' }).click({ modifiers: ['ControlOrMeta'] });
  await expect(box('r2')).not.toBeChecked();

  await list.getByRole('link', { name: 'Page r1' }).click({ modifiers: ['ControlOrMeta'] });
  await list.getByRole('link', { name: 'Page r3' }).click({ modifiers: ['Shift'] });
  await expect(list.getByRole('checkbox', { name: /^Select Page/, checked: true })).toHaveCount(3);
  await expect(box('r4')).not.toBeChecked();
  await expect(list.locator('.tab-link')).toHaveCount(4);
  expect(openUrls(context)).toEqual([]);
});

import { expect, onetabPage, openPages, sendWindow, test } from './fixtures';

test('the Tasks view lists a task and marks it done', async ({ context, worker, extensionId }) => {
  await openPages(context, ['t1', 't2']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);

  const row = list.locator('.tab').filter({ hasText: 'Page t2' });
  await row.hover();
  await row.getByRole('button', { name: 'More actions for Page t2' }).click();
  await list.getByRole('menuitem', { name: 'Make this a task' }).click();

  await list.getByRole('button', { name: 'Tasks (1 pending, 0 done)' }).click();
  const tasks = list.getByRole('region', { name: 'Tasks' });
  await expect(tasks.getByRole('button')).toHaveText(['Page t2']);
  await tasks.getByRole('checkbox', { name: 'Task done' }).check();
  await list.getByRole('button', { name: 'Back to list' }).click();
  await expect(list.getByRole('button', { name: 'Tasks (0 pending, 1 done)' })).toBeVisible();
});

test('a quick list entry is added and removed, and the item stays in the list', async ({
  context,
  worker,
  extensionId,
}) => {
  await openPages(context, ['q1', 'q2']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);
  const quick = list.getByRole('list', { name: 'Quick list' });

  const row = list.locator('.tab').filter({ hasText: 'Page q1' });
  await row.hover();
  await row.getByRole('button', { name: 'More actions for Page q1' }).click();
  await list.getByRole('menuitem', { name: 'Add to quick list' }).click();
  await list.locator('.group').getByRole('button', { name: 'More…' }).click();
  await list.getByRole('menuitem', { name: 'Add to quick list' }).click();
  await expect(quick.getByRole('button')).toHaveText(['Page q1', '2 tabs']);

  await row.hover();
  await row.getByRole('button', { name: 'More actions for Page q1' }).click();
  await list.getByRole('menuitem', { name: 'Remove from quick list' }).click();
  await expect(quick.getByRole('button')).toHaveText(['2 tabs']);
  await expect(list.locator('.tab-link')).toHaveText(['Page q1', 'Page q2']);
});

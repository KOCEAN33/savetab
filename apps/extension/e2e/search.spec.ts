import { expect, onetabPage, openPages, sendWindow, test } from './fixtures';

test('typing a term shows matching tabs and the match count', async ({ context, worker, extensionId }) => {
  await openPages(context, ['alpha', 'beta', 'alphabet']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);

  await list.getByRole('searchbox', { name: 'Search' }).fill('alpha');
  await expect(list.getByRole('status')).toHaveText('2 matches');
  await expect(list.locator('main .tab-link')).toHaveText(['Page alpha', 'Page alphabet']);

  await list.getByRole('button', { name: 'Filters' }).click();
  await list.getByRole('checkbox', { name: 'Whole words' }).check();
  await expect(list.getByRole('status')).toHaveText('1 match');
  await expect(list.locator('main .tab-link')).toHaveText(['Page alpha']);

  await list.getByRole('searchbox', { name: 'Search' }).fill('');
  await list.getByRole('checkbox', { name: 'Whole words' }).uncheck();
  await expect(list.locator('main .tab-link')).toHaveCount(3);
});

test('the omnibox hands its text to the page as ?q=', async ({ context, worker, extensionId }) => {
  await openPages(context, ['gamma', 'delta']);
  await sendWindow(worker);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/onetab.html?q=gamma`);
  await expect(page.getByRole('searchbox', { name: 'Search' })).toHaveValue('gamma');
  await expect(page.locator('main .tab-link')).toHaveText(['Page gamma']);
});

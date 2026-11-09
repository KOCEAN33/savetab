import { expect, onetabPage, openPages, sendWindow, SITE, test } from './fixtures';

test('a browser tab group stores as its own group and restores as a tab group with its title and color', async ({
  context,
  worker,
  extensionId,
}) => {
  await openPages(context, ['g1', 'g2', 'p3']);
  await worker.evaluate(async (site) => {
    const [a, b] = await chrome.tabs.query({ url: [`${site}/g1`, `${site}/g2`] });
    const groupId = await chrome.tabs.group({ tabIds: [a!.id!, b!.id!] });
    await chrome.tabGroups.update(groupId, { title: 'Work', color: 'blue' });
  }, SITE);
  await sendWindow(worker, 'sendWholeWindow');
  const list = await onetabPage(context, extensionId);

  await expect(list.locator('.group-label')).toHaveText(['Work', '1 tab']);
  await expect(list.locator('.group').first().locator('.tab-link')).toHaveText(['Page g1', 'Page g2']);
  expect(await worker.evaluate(() => chrome.tabGroups.query({}))).toEqual([]);

  await list.locator('.group').first().getByRole('button', { name: 'Restore all' }).click();
  await expect
    .poll(() =>
      worker.evaluate(async () => {
        const groups = await chrome.tabGroups.query({});
        return Promise.all(
          groups.map(async (g) => ({
            title: g.title,
            color: g.color,
            urls: (await chrome.tabs.query({ groupId: g.id })).map((t) => t.url ?? t.pendingUrl),
          })),
        );
      }),
    )
    .toEqual([{ title: 'Work', color: 'blue', urls: [`${SITE}/g1`, `${SITE}/g2`] }]);
});

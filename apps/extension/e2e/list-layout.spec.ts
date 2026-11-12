import type { BrowserContext, Page } from '@playwright/test';
import { drag, expect, SITE, test } from './fixtures';

/** Import `text` through the import page, then open the list page in the same tab. */
async function importText(context: BrowserContext, extensionId: string, text: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/import-export.html`);
  await page.getByRole('textbox', { name: 'Links to import' }).fill(text);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('status').first()).toContainText('Imported');
  await page.goto(`chrome-extension://${extensionId}/onetab.html`);
  return page;
}

test('Delete all in the group head moves the group to the trash', async ({ context, extensionId }) => {
  const list = await importText(context, extensionId, 'https://a.example/ | A\nhttps://b.example/ | B\n\nhttps://c.example/ | C');
  const group = list.locator('main .group').first();
  await group.locator('.group-head').hover();
  await group.getByRole('button', { name: 'Delete all' }).click();
  await expect(list.locator('main .tab-link')).toHaveText(['C']);
  await expect(list.getByRole('button', { name: 'Trash (1)' })).toBeVisible();
});

test('the head of the group being scrolled stays under the top bar', async ({ context, extensionId }) => {
  const long = Array.from({ length: 60 }, (_, i) => `https://l${i}.example/ | L${i}`).join('\n');
  const list = await importText(context, extensionId, `${long}\n\nhttps://z.example/ | Z`);
  const head = list.locator('main .group-head').first();
  await list.mouse.wheel(0, 900);
  await expect.poll(async () => (await list.locator('main .tab-link').first().boundingBox())!.y).toBeLessThan(0);
  const bar = (await list.locator('.top-bar').boundingBox())!;
  const box = (await head.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
  expect(box.y).toBeLessThan(bar.y + bar.height + 8);
});

test('a group drags by the empty space after its date', async ({ context, extensionId }) => {
  const list = await importText(context, extensionId, 'https://a.example/ | A\n\nhttps://b.example/ | B');
  const [top, bottom] = [list.locator('main .group').nth(0), list.locator('main .group').nth(1)];
  const meta = (await top.locator('.group-head > .meta').boundingBox())!;
  const actions = (await top.locator('.group-actions').boundingBox())!;
  const handle = top.getByLabel('Drag 1 tab');
  const box = (await handle.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(meta.x + meta.width);
  expect(box.x + box.width).toBeLessThanOrEqual(actions.x);
  expect(box.width).toBeGreaterThan(200);
  await drag(list, handle, bottom);
  await expect(list.locator('main .tab-link')).toHaveText(['B', 'A']);
});

test('an imported link shows its site favicon, and a site without one shows none', async ({ context, extensionId }) => {
  const list = await importText(context, extensionId, `${SITE}/some/page | F\nhttps://nothing.invalid/ | N`);
  const icon = list.locator('main .tab').filter({ hasText: 'F' }).locator('.tab-icon');
  await expect(icon).toHaveAttribute('src', `${SITE}/favicon.ico`);
  await expect.poll(() => icon.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await expect(list.locator('main .tab').filter({ hasText: 'N' }).locator('img')).toHaveCount(0);
});

test('a rectangle dragged from the empty margin selects the rows it covers', async ({ context, extensionId }) => {
  const list = await importText(context, extensionId, 'https://m1.example/ | M1\nhttps://m2.example/ | M2\nhttps://m3.example/ | M3');
  const rows = list.locator('main .tab');
  const first = (await rows.nth(0).boundingBox())!;
  const second = (await rows.nth(1).boundingBox())!;
  const x = first.x - 60;
  await list.mouse.move(x, first.y + 4);
  await list.mouse.down();
  await list.mouse.move(first.x + 100, second.y + second.height / 2, { steps: 8 });
  await list.mouse.up();
  await expect(list.getByRole('checkbox', { name: /^Select M/, checked: true })).toHaveCount(2);
  await expect(list.getByRole('checkbox', { name: 'Select M3' })).not.toBeChecked();
  await expect(list.locator('main .tab-link')).toHaveText(['M1', 'M2', 'M3']);
});

test('a click anywhere in the margin beside a row ticks it', async ({ context, extensionId }) => {
  const list = await importText(context, extensionId, 'https://t1.example/ | T1\nhttps://t2.example/ | T2');
  const row = list.locator('main .tab').first();
  const box = (await row.boundingBox())!;
  await row.hover();
  await list.mouse.click(box.x - 26, box.y + 3);
  await expect(list.getByRole('checkbox', { name: 'Select T1' })).toBeChecked();
  await expect(list.getByRole('checkbox', { name: 'Select T2' })).not.toBeChecked();
});

import { test } from './fixtures';
const DATA = `https://news.ycombinator.com/item?id=41234567 | Show HN: A tiny Postgres-backed sync server
https://developer.chrome.com/docs/extensions/reference/api/tabs | chrome.tabs | API | Chrome for Developers
https://wxt.dev/guide/essentials/entrypoints.html | Entrypoints | WXT
https://namu.wiki/w/firefox | 파이어폭스 - 나무위키

https://www.youtube.com/watch?v=abc | 2026 홈랩 쿠버네티스 구성기 - YouTube
https://github.com/rocicorp/fractional-indexing | GitHub - rocicorp/fractional-indexing: Fractional indexing
https://svelte.dev/docs/svelte/$derived | $derived • Svelte Docs
https://blog.example.kr/posts/postgres-logical-replication | Postgres 논리 복제로 다중 기기 동기화 만들기
https://www.rfc-editor.org/rfc/rfc9562 | RFC 9562: Universally Unique IDentifiers (UUIDs)

https://map.naver.com/ | 네이버 지도
https://www.coupang.com/vp/products/1 | 쿠팡! | 로지텍 MX Keys
`;
for (const [name, w, h] of [
  ['desktop', 1440, 900],
  ['mobile', 390, 844],
] as const) {
  test(`shots ${name}`, async ({ context, extensionId }) => {
    const p = await context.newPage();
    await p.setViewportSize({ width: w, height: h });
    await p.goto(`chrome-extension://${extensionId}/import-export.html`);
    await p.getByRole('textbox', { name: 'Links to import' }).fill(DATA);
    await p.getByRole('button', { name: 'Import' }).click();
    await p.screenshot({ path: `/tmp/savetab-shots/import-export-${name}.png`, fullPage: true });
    await p.goto(`chrome-extension://${extensionId}/onetab.html`);
    const first = p.locator('.group').first();
    await first.getByRole('button', { name: 'More…' }).click();
    await p.getByRole('menuitem', { name: 'Lock this tab group' }).click();
    await first.getByRole('button', { name: 'More…' }).click();
    await p.getByRole('menuitem', { name: 'Star this tab group' }).click();
    await p.locator('.group').nth(1).getByRole('button', { name: '5 tabs', exact: true }).click();
    await p.locator('.group-title-input').fill('Sync server research');
    await p.keyboard.press('Enter');
    await p.waitForTimeout(300);
    await p.screenshot({ path: `/tmp/savetab-shots/onetab-${name}.png`, fullPage: true });
    await p.locator('.group').nth(2).getByRole('button', { name: 'More…' }).click();
    await p.screenshot({ path: `/tmp/savetab-shots/onetab-menu-${name}.png`, fullPage: true });
    await p.keyboard.press('Escape');
    await p.getByRole('button', { name: 'Theme: Automatic' }).click();
    await p.getByRole('button', { name: 'Theme: Light' }).click();
    await p.screenshot({ path: `/tmp/savetab-shots/onetab-dark-${name}.png`, fullPage: true });
    await p.goto(`chrome-extension://${extensionId}/options.html`);
    await p.screenshot({ path: `/tmp/savetab-shots/options-${name}.png`, fullPage: true });
  });
}

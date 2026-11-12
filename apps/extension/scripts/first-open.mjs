// Measures how long the list page takes to show its first group with 3,000 stored links in 150
// groups, for savetab and for an unpacked OneTab, in Playwright Chromium.
//
//   pnpm --filter @savetab/extension build
//   node apps/extension/scripts/first-open.mjs <unpacked OneTab directory>
//
// The numbers in docs/candidates.md came from a copy of the directory Chrome installs OneTab
// into, `<profile>/Extensions/chphlpgkkbolifaimnlloiipkdnihall/<version>`, with its `_metadata`
// folder removed.
//
// The time runs from navigation start to the second animation frame after the first group
// element is in the document, which is the first frame that has painted it.
import { chromium } from '@playwright/test';
import path from 'node:path';

const GROUPS = 150;
const PER_GROUP = 20;
const RUNS = 15;

const onetabDir = process.argv[2];
if (!onetabDir) {
  console.error('usage: node first-open.mjs <unpacked OneTab directory>');
  process.exit(1);
}

const groups = Array.from({ length: GROUPS }, (_, g) =>
  Array.from({ length: PER_GROUP }, (_, i) => `https://example.com/group-${g}/page-${i} | Group ${g} page ${i}`),
);

const extensions = [
  {
    name: 'savetab',
    dir: path.resolve(import.meta.dirname, '../.output/chrome-mv3'),
    importPage: 'import-export.html',
    listPage: 'onetab.html',
    group: '.group',
    async seed(page) {
      await page.locator('textarea:not([readonly])').fill(groups.map((g) => g.join('\n')).join('\n\n'));
      await page.locator('button.button-primary').first().click();
    },
  },
  {
    name: 'OneTab',
    dir: path.resolve(onetabDir),
    importPage: 'import-export.html',
    listPage: 'onetab.html',
    group: '.tabGroup',
    async seed(page) {
      // The import box is an editable frame. One div per line is what a paste leaves in it.
      await page.frames()[1].evaluate((groups) => {
        const line = (text) => {
          const div = document.createElement('div');
          if (text) div.textContent = text;
          else div.append(document.createElement('br'));
          return div;
        };
        document.body.replaceChildren(...groups.flatMap((g) => [...g, ''].map(line)));
      }, groups);
      await page.locator('.button').first().click();
    },
  },
];

function median(values) {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

for (const ext of extensions) {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [`--disable-extensions-except=${ext.dir}`, `--load-extension=${ext.dir}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const origin = `chrome-extension://${new URL(worker.url()).host}`;
  await context.addInitScript((selector) => {
    new MutationObserver((_, observer) => {
      if (!document.querySelector(selector)) return;
      observer.disconnect();
      requestAnimationFrame(() => requestAnimationFrame(() => (window.firstGroupAt = performance.now())));
    }).observe(document, { childList: true, subtree: true });
  }, ext.group);

  const importer = await context.newPage();
  await importer.goto(`${origin}/${ext.importPage}`);
  await importer.waitForLoadState('load');
  await new Promise((r) => setTimeout(r, 1000));
  await ext.seed(importer);

  // The import is done when a fresh list page reports every link.
  const want = `https://example.com/group-${GROUPS - 1}/page-${PER_GROUP - 1}`;
  const deadline = Date.now() + 120_000;
  let stored = 0;
  while (stored < GROUPS * PER_GROUP) {
    if (Date.now() > deadline) throw new Error(`${ext.name}: import stored ${stored} links in 120 s`);
    await new Promise((r) => setTimeout(r, 2000));
    const check = await context.newPage();
    await check.goto(`${origin}/${ext.importPage}`);
    await check.locator('textarea').first().waitFor();
    await new Promise((r) => setTimeout(r, 1500));
    const exported = await check.evaluate(() => [...document.querySelectorAll('textarea')].map((t) => t.value).join('\n'));
    stored = exported.split('\n').filter((l) => l.startsWith('https://example.com/group-')).length;
    if (stored && !exported.includes(want)) stored = 0;
    await check.close();
  }
  for (const page of context.pages()) await page.close().catch(() => {});

  const times = [];
  let shown = 0;
  for (let i = 0; i < RUNS; i++) {
    const page = await context.newPage();
    await page.goto(`${origin}/${ext.listPage}`);
    await page.waitForFunction(() => window.firstGroupAt !== undefined);
    times.push(await page.evaluate(() => window.firstGroupAt));
    shown = await page.locator(ext.group).count();
    await page.close();
  }
  console.log(
    `${ext.name}: median ${Math.round(median(times))} ms, min ${Math.round(Math.min(...times))} ms, max ${Math.round(Math.max(...times))} ms over ${RUNS} opens, ${stored} links stored, ${shown} groups in the document at measure time`,
  );
  await context.close();
}

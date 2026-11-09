<script lang="ts">
  import { liveQuery } from 'dexie';
  import { browser } from 'wxt/browser';
  import { exportText, importGroups, ListView, parseImportText, type ItemRecord } from '@savetab/core';
  import { db, transact } from '@/lib/db';
  import { t, tn } from '@/lib/i18n';

  const records = liveQuery(() => db.items.toArray());

  const exported = $derived.by(() => {
    const view = new ListView(($records ?? []) as ItemRecord[]);
    return exportText(view.groups(null).map((g) => view.tabs(g.id).map((t) => ({ url: t.url, title: view.title(t) }))));
  });

  const importHint = t('importHint').split('{format}');

  let input = $state('');
  let result = $state('');

  async function runImport() {
    const groups = parseImportText(input);
    const count = groups.reduce((n, g) => n + g.length, 0);
    if (count === 0) {
      result = t('noLinksFound');
      return;
    }
    await transact((tx) => importGroups(tx, groups.map((g) => g.map((t) => ({ ...t, favIconUrl: '' })))));
    result = t('imported', { tabs: tn('tabCount', count), groups: tn('groupCount', groups.length) });
    input = '';
  }
</script>

<main>
  <header class="page-header">
    <h1 class="page-total">{t('importExportTitle')}</h1>
    <nav class="page-nav"><a class="link-button" href={browser.runtime.getURL('/onetab.html')}>{t('backToSavetab')}</a></nav>
  </header>

  <h2 class="section-title">{t('exportTitle')}</h2>
  <p class="meta">{t('exportHint')}</p>
  <textarea class="text-block" readonly aria-label={t('exportedLinks')} value={exported}></textarea>

  <h2 class="section-title">{t('importTitle')}</h2>
  <p class="meta">{importHint[0]}<code>URL | Title</code>{importHint[1]}</p>
  <textarea class="text-block" aria-label={t('linksToImport')} bind:value={input} oninput={() => (result = '')}></textarea>
  <p class="row">
    <button class="button button-primary" onclick={runImport}>{t('import')}</button>
    <span role="status">{result}</span>
  </p>
</main>

<script lang="ts">
  import { liveQuery } from 'dexie';
  import { browser } from 'wxt/browser';
  import { exportText, importGroups, ListView, parseImportText, type ItemRecord } from '@savetab/core';
  import { db, transact } from '@/lib/db';

  const records = liveQuery(() => db.items.toArray());

  const exported = $derived.by(() => {
    const view = new ListView(($records ?? []) as ItemRecord[]);
    return exportText(view.groups(null).map((g) => view.tabs(g.id).map((t) => ({ url: t.url, title: view.title(t) }))));
  });

  let input = $state('');
  let result = $state('');

  async function runImport() {
    const groups = parseImportText(input);
    const count = groups.reduce((n, g) => n + g.length, 0);
    if (count === 0) {
      result = 'No links found. Each line needs a URL with its protocol, such as https://example.com | Title';
      return;
    }
    await transact((tx) => importGroups(tx, groups.map((g) => g.map((t) => ({ ...t, favIconUrl: '' })))));
    result = `Imported ${count} ${count === 1 ? 'tab' : 'tabs'} in ${groups.length} ${groups.length === 1 ? 'group' : 'groups'}.`;
    input = '';
  }
</script>

<main>
  <header class="page-header">
    <h1 class="page-total">Import / Export</h1>
    <nav class="page-nav"><a class="link-button" href={browser.runtime.getURL('/onetab.html')}>Back to savetab</a></nav>
  </header>

  <h2 class="section-title">Export</h2>
  <p class="meta">This list can be imported into savetab or OneTab on this or another computer.</p>
  <textarea class="text-block" readonly aria-label="Exported links" value={exported}></textarea>

  <h2 class="section-title">Import</h2>
  <p class="meta">One link per line as <code>URL | Title</code>. A blank line starts a new group.</p>
  <textarea class="text-block" aria-label="Links to import" bind:value={input} oninput={() => (result = '')}></textarea>
  <p class="row">
    <button class="button button-primary" onclick={runImport}>Import</button>
    <span role="status">{result}</span>
  </p>
</main>

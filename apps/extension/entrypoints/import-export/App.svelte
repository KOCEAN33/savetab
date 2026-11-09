<script lang="ts">
  import { liveQuery } from 'dexie';
  import { SvelteSet } from 'svelte/reactivity';
  import { browser, type Browser } from 'wxt/browser';
  import {
    exportText,
    importBookmarks,
    importGroups,
    ListView,
    parseImportText,
    type BookmarkFolder,
    type ItemRecord,
  } from '@savetab/core';
  import { db, transact } from '@/lib/db';
  import { t, tn } from '@/lib/i18n';
  import { linksFromHtml } from '@/lib/links-in';

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

  /** A rich text paste becomes `URL | Title` lines for its links. Plain text pastes as usual. */
  function pasteRich(e: ClipboardEvent) {
    const el = e.currentTarget as HTMLTextAreaElement;
    const links = linksFromHtml(e.clipboardData?.getData('text/html') ?? '');
    if (links.length === 0) return;
    e.preventDefault();
    input = input.slice(0, el.selectionStart) + exportText([links]).trimEnd() + input.slice(el.selectionEnd);
    result = '';
  }

  type BookmarkNode = Browser.bookmarks.BookmarkTreeNode;

  let bookmarkRoots = $state<BookmarkNode[] | null>(null);
  const chosen = new SvelteSet<string>();
  let bookmarkResult = $state('');

  /** `bookmarks` is optional, so the request runs first in the click, while the user gesture lasts. */
  async function loadBookmarks() {
    if (!(await browser.permissions.request({ permissions: ['bookmarks'] }))) return;
    bookmarkRoots = (await browser.bookmarks.getTree())[0]?.children ?? [];
    bookmarkResult = '';
  }

  const isFolder = (n: BookmarkNode) => n.url === undefined;

  function toFolder(n: BookmarkNode): BookmarkFolder {
    const children = n.children ?? [];
    return {
      title: n.title,
      links: children.filter((c) => !isFolder(c)).map((c) => ({ url: c.url!, title: c.title, favIconUrl: '' })),
      folders: children.filter(isFolder).map(toFolder),
    };
  }

  async function importChosen() {
    const picked: BookmarkNode[] = [];
    const walk = (nodes: BookmarkNode[]) => {
      for (const n of nodes.filter(isFolder)) {
        if (chosen.has(n.id)) picked.push(n);
        walk(n.children ?? []);
      }
    };
    walk(bookmarkRoots ?? []);
    if (picked.length === 0) return;
    await transact(async (tx) => {
      for (const n of [...picked].reverse()) await importBookmarks(tx, toFolder(n));
    });
    bookmarkResult = t('importedFolders', { folders: tn('folderCount', picked.length) });
    chosen.clear();
  }

  /** Chrome only. The API appears once the optional permission is granted. */
  const hasReadingList = !import.meta.env.FIREFOX;
  let readingResult = $state('');

  async function importReadingList() {
    if (!(await browser.permissions.request({ permissions: ['readingList'] }))) return;
    const entries = await browser.readingList.query({});
    if (entries.length === 0) {
      readingResult = t('readingListEmpty');
      return;
    }
    await transact((tx) => importGroups(tx, [entries.map((e) => ({ url: e.url, title: e.title, favIconUrl: '' }))]));
    readingResult = t('imported', { tabs: tn('tabCount', entries.length), groups: tn('groupCount', 1) });
  }
</script>

{#snippet folderTree(nodes: BookmarkNode[])}
  <ul class="bookmark-tree">
    {#each nodes.filter(isFolder) as n (n.id)}
      <li>
        <label>
          <input
            type="checkbox"
            checked={chosen.has(n.id)}
            onchange={(e) => (e.currentTarget.checked ? chosen.add(n.id) : chosen.delete(n.id))}
          />
          {n.title}
        </label>
        {@render folderTree(n.children ?? [])}
      </li>
    {/each}
  </ul>
{/snippet}

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
  <textarea
    class="text-block"
    aria-label={t('linksToImport')}
    bind:value={input}
    oninput={() => (result = '')}
    onpaste={pasteRich}
  ></textarea>
  <p class="row">
    <button class="button button-primary" onclick={runImport}>{t('import')}</button>
    <span role="status">{result}</span>
  </p>

  <h2 class="section-title">{t('bookmarksTitle')}</h2>
  {#if bookmarkRoots}
    <p class="meta">{t('bookmarksHint')}</p>
    {@render folderTree(bookmarkRoots)}
    <p class="row">
      <button class="button button-primary" disabled={chosen.size === 0} onclick={importChosen}>{t('importChosenFolders')}</button>
      <span role="status">{bookmarkResult}</span>
    </p>
  {:else}
    <p class="row">
      <button class="button" onclick={loadBookmarks}>{t('importBookmarks')}</button>
      <span role="status">{bookmarkResult}</span>
    </p>
  {/if}

  {#if hasReadingList}
    <h2 class="section-title">{t('readingListTitle')}</h2>
    <p class="row">
      <button class="button" onclick={importReadingList}>{t('importReadingList')}</button>
      <span role="status">{readingResult}</span>
    </p>
  {/if}
</main>

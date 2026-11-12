<script lang="ts">
  import { liveQuery } from 'dexie';
  import { tick } from 'svelte';
  import { dndzone, dragHandleZone, setKeyboardDragTrigger, TRIGGERS, type DndEvent } from 'svelte-dnd-action';
  import { browser } from 'wxt/browser';
  import {
    copyItems,
    createFolder,
    importGroups,
    emptyQuery,
    isActive,
    ListView,
    search,
    sortGroups,
    moveItems,
    moveToNewGroup,
    tabTitle,
    type Group,
    type Id,
    type Item,
    type ItemRecord,
    type SearchQuery,
    type SortKey,
    type Tab,
  } from '@savetab/core';
  import { db, syncAccount, transact } from '@/lib/db';
  import { DROP_TARGET, FLIP_MS } from '@/lib/motion';
  import { touchRecent } from '@/lib/recent';
  import { navigate } from '@/lib/keynav';
  import { linksFromData } from '@/lib/links-in';
  import { restoredItem } from '@/lib/backup';
  import { editing, keys, menu } from '@/lib/ui.svelte';
  import { t, tn } from '@/lib/i18n';
  import { deviceSettingsItem, getDeviceSettings, setDeviceSettings } from '@/lib/settings';
  import type { Theme } from '@/lib/theme';
  import FolderRow from '@/components/FolderRow.svelte';
  import GroupView from '@/components/GroupView.svelte';
  import LocationDialog from '@/components/LocationDialog.svelte';
  import SelectionBar from '@/components/SelectionBar.svelte';
  import FolderBar from '@/components/FolderBar.svelte';
  import Icon from '@/components/Icon.svelte';
  import ItemMenu from '@/components/ItemMenu.svelte';
  import SearchBar from '@/components/SearchBar.svelte';
  import TrashView from '@/components/TrashView.svelte';

  // Enter stays free for opening links; Space starts a keyboard drag.
  setKeyboardDragTrigger('space');

  // Ceiling: the page reads every record on each change. Fine for tens of thousands of
  // tabs; switch to per-folder queries if large lists stutter.
  const records = liveQuery(() => db.items.toArray());
  const account = liveQuery(() => syncAccount());

  let mode = $state<'list' | 'trash'>('list');

  /** Shown once: the background restored the list from the backup taken at this time. */
  let restoredFrom = $state<number | null>(null);
  function showRestored(at: number | null) {
    if (at === null) return;
    restoredFrom = at;
    void restoredItem.setValue(null);
  }
  void restoredItem.getValue().then(showRestored);
  restoredItem.watch(showRestored);
  // The omnibox opens the page with ?q=<text>.
  let query = $state<SearchQuery>({ ...emptyQuery, text: new URLSearchParams(location.search).get('q') ?? '' });
  let draggingTab = $state(false);
  let current = $state<Id | null>(location.hash.slice(1) || null);

  const all = $derived(($records ?? []) as ItemRecord[]);
  const view = $derived(new ListView(all));
  // A folder trashed from another page or device sends this page back to the root.
  const folder = $derived(current && view.get(current)?.kind === 'folder' ? current : null);
  const total = $derived(view.tabCount(null));
  const countAll = (id: string) => all.filter((r) => r.parentId === id && r.kind === 'tab' && !r.purged).length;
  const trashTitle = (r: ItemRecord) => tabTitle(r as Tab, view.link(r as Tab));

  const results = $derived(isActive(query) ? search(view, query) : null);

  /** Items per page in a folder. A long folder pages with "Next {N}" and "Previous {N}". */
  const PAGE_SIZE = 50;
  let page = $state(0);
  $effect(() => {
    void folder;
    page = 0;
  });
  const groups = $derived(view.children(folder).filter((i): i is Group => i.kind === 'group'));

  /** Groups drawn before the first paint. The rest of the page follows in later frames, so a long list shows at once. */
  const FIRST_PAINT = 8;
  let limit = $state(FIRST_PAINT);
  $effect(() => {
    if (groups.length > 0 && limit < PAGE_SIZE) requestAnimationFrame(() => (limit += FIRST_PAINT));
  });
  const shown = () => groups.slice(pageStart, pageStart + Math.min(limit, PAGE_SIZE));
  const pageCount = $derived(Math.max(1, Math.ceil(groups.length / PAGE_SIZE)));
  const pageStart = $derived(Math.min(page, pageCount - 1) * PAGE_SIZE);
  /** The first group after the ones drawn: a drop at the end lands before it. */
  const afterShown = $derived(groups[pageStart + Math.min(limit, PAGE_SIZE)]?.id ?? null);
  const nextCount = $derived(Math.min(PAGE_SIZE, groups.length - pageStart - PAGE_SIZE));

  let items = $derived(shown());
  /** Groups and tabs of the open folder, top to bottom, for the tick menu's range commands. */
  const order = $derived(groups.flatMap((g) => [g.id, ...view.tabs(g.id).map((t) => t.id)]));
  const menuItem = $derived(menu.id ? view.get(menu.id) : undefined);
  let newGroupItems = $state<Tab[]>([]);

  let theme = $state<Theme>('auto');
  void getDeviceSettings().then((d) => (theme = d.theme));
  deviceSettingsItem.watch((d) => (theme = d?.theme ?? 'auto'));
  const NEXT_THEME: Record<Theme, Theme> = { auto: 'light', light: 'dark', dark: 'auto' };
  const THEME_NAME = { auto: 'themeAuto', light: 'themeLight', dark: 'themeDark' } as const;

  $effect(() => {
    history.replaceState(null, '', folder ? `#${folder}` : location.pathname);
  });

  function run<T>(fn: Parameters<typeof transact<T>>[0]): Promise<T | undefined> {
    return transact(fn).catch((err) => {
      items = shown();
      newGroupItems = [];
      alert(err instanceof Error ? err.message : String(err));
      return undefined;
    });
  }

  async function open(item: Item | null) {
    mode = 'list';
    if (item === null || item.kind === 'folder') {
      current = item?.id ?? null;
      if (item) void touchRecent(item.id);
      return;
    }
    const group = item.kind === 'tab' && item.parentId ? view.get(item.parentId) : item;
    current = group?.parentId ?? null;
    await tick();
    document.querySelector(`[data-id="${item.id}"]`)?.scrollIntoView({ block: 'start' });
  }

  let mainEl = $state<HTMLElement>();

  function onListKey(e: KeyboardEvent) {
    if (!mainEl?.contains(e.target as Node)) return;
    const parent = folder ? (view.get(folder)?.parentId ?? null) : undefined;
    if (navigate(e, mainEl!, () => parent !== undefined && open(parent === null ? null : view.get(parent)!))) {
      e.preventDefault();
    }
  }

  /** `/` focuses search. Alt+/ also restricts it to the open folder. Keys typed into a field are left alone. */
  function onWindowKey(e: KeyboardEvent) {
    onListKey(e);
    const t = e.target as HTMLElement;
    if (e.code !== 'Slash' || e.ctrlKey || e.metaKey || t.closest('input, textarea, select, [contenteditable]')) return;
    e.preventDefault();
    mode = 'list';
    if (e.altKey) query.folderId = folder;
    document.querySelector<HTMLInputElement>('.search-input')?.focus();
  }

  async function newFolder() {
    const id = await run((tx) => createFolder(tx, folder, ''));
    if (id) editing.title = id;
  }

  function finalizeItems(e: CustomEvent<DndEvent<Group>>) {
    items = e.detail.items;
    const { id, trigger } = e.detail.info;
    const copy = keys.copy;
    // A copy leaves the source in place, which the list's own data never stopped showing.
    if (copy || trigger !== TRIGGERS.DROPPED_INTO_ZONE) items = shown();
    if (trigger !== TRIGGERS.DROPPED_INTO_ZONE) return;
    const at = e.detail.items.findIndex((g) => g.id === id);
    if (at === -1) return;
    const before = e.detail.items[at + 1]?.id ?? afterShown;
    void run(async (tx) => {
      if (copy) await copyItems(tx, [id], folder, before);
      else await moveItems(tx, [id], folder, before);
    });
  }

  const LINK_TYPES = ['text/uri-list', 'text/html', 'text/plain'];

  /** Links dropped from outside the page become a new group at the top of the open folder. */
  function dropLinks(e: DragEvent) {
    const data = e.dataTransfer;
    if (!data || !LINK_TYPES.some((type) => data.types.includes(type))) return;
    e.preventDefault();
    const links = linksFromData(data).map((l) => ({ ...l, favIconUrl: '' }));
    const parent = folder;
    if (links.length > 0) void run((tx) => importGroups(tx, [links], parent));
  }

  function finalizeNewGroup(e: CustomEvent<DndEvent<Tab>>) {
    draggingTab = false;
    const { id, trigger } = e.detail.info;
    newGroupItems = [];
    if (trigger === TRIGGERS.DROPPED_INTO_ZONE) void run((tx) => moveToNewGroup(tx, [id], folder));
  }
</script>

<!-- The drop finishes after the drop animation, by which time the key may be up, so the
     modifier state comes from the last pointer event, which is the release itself. -->
<svelte:window
  onkeydown={onWindowKey}
  onmousemovecapture={(e) => (keys.copy = e.ctrlKey || e.altKey)}
  onmouseupcapture={(e) => (keys.copy = e.ctrlKey || e.altKey)}
/>

<header class="top-bar">
  <div class="top-bar-in">
    <button class="brand" onclick={() => open(null)}><img src="/icon/48.png" alt="" /><span class="brand-name">savetab</span></button>
    <SearchBar bind:query {view} count={results?.count ?? null} />
    <nav class="page-nav">
      <button
        class="icon-button"
        title={t('trashLink', { n: view.trashed.length })}
        aria-label={t('trashLink', { n: view.trashed.length })}
        aria-pressed={mode === 'trash'}
        onclick={() => (mode = mode === 'trash' ? 'list' : 'trash')}><Icon name="trash" /></button
      >
      <a class="icon-button" title={t('importExport')} aria-label={t('importExport')} href={browser.runtime.getURL('/import-export.html')}
        ><Icon name="transfer" /></a
      >
      <button
        class="icon-button"
        title={t('themeButton', { name: t(THEME_NAME[theme]) })}
        aria-label={t('themeButton', { name: t(THEME_NAME[theme]) })}
        onclick={() => setDeviceSettings({ theme: NEXT_THEME[theme] })}><Icon name="theme" /></button
      >
      <button class="icon-button" title={t('options')} aria-label={t('options')} onclick={() => browser.runtime.openOptionsPage()}
        ><Icon name="settings" /></button
      >
    </nav>
  </div>
</header>

<!-- svelte-dnd-action drags with pointer events, so a native drop here always comes from outside. -->
<main
  class="list-page"
  bind:this={mainEl}
  ondragover={(e) => {
    if (e.dataTransfer && LINK_TYPES.some((type) => e.dataTransfer!.types.includes(type))) e.preventDefault();
  }}
  ondrop={dropLinks}
>
  {#if restoredFrom !== null}
    <p role="alert">{t('restoredFromBackup', { date: new Date(restoredFrom).toLocaleString() })}</p>
  {/if}

  {#if mode === 'trash'}
    <p><button class="link-button" onclick={() => (mode = 'list')}>{t('backToList')}</button></p>
    <TrashView trashed={view.trashed} tabCount={countAll} tabTitle={trashTitle} />
  {:else if results}
    <SelectionBar {view} order={results.groups.flatMap((r) => [r.group.id, ...r.tabs.map((t) => t.id)])} />
    {#each results.folders as f (f.id)}
      <FolderRow folder={f} {view} onopen={() => ((query = { ...emptyQuery }), open(f))} />
    {/each}
    {#each results.groups as r (r.group.id)}
      <GroupView group={r.group} {view} shown={r.tabs} ondragging={() => {}} />
    {/each}
  {:else}
    <div class="list-head">
      <FolderBar {view} current={folder} onopen={open} onnew={newFolder} />
      <div class="list-tools">
        <h1 class="page-total meta">{tn('pageTotal', total)}</h1>
        <select
          aria-label={t('sortGroups')}
          value=""
          onchange={(e) => {
            const [key, dir] = e.currentTarget.value.split(':') as [SortKey, string];
            e.currentTarget.value = '';
            void run((tx) => sortGroups(tx, folder, key, dir === 'reverse'));
          }}
        >
          <option value="" disabled>{t('sortGroups')}</option>
          <option value="title:">{t('sortTitle')}</option>
          <option value="title:reverse">{t('sortTitleReverse')}</option>
          <option value="created:">{t('sortCreated')}</option>
          <option value="created:reverse">{t('sortCreatedReverse')}</option>
          <option value="modified:">{t('sortModified')}</option>
          <option value="modified:reverse">{t('sortModifiedReverse')}</option>
          <option value="accessed:">{t('sortAccessed')}</option>
          <option value="accessed:reverse">{t('sortAccessedReverse')}</option>
        </select>
      </div>
    </div>

    <SelectionBar {view} {order} />

    {#if groups.length === 0}
      <p class="empty meta">
        {folder ? t('emptyFolder') : t('emptyList')}
      </p>
    {/if}

    <div
      class="groups"
      use:dragHandleZone={{ items, type: 'group', flipDurationMs: FLIP_MS, useCursorForDetection: true, zoneTabIndex: -1, zoneItemTabIndex: -1, ...DROP_TARGET }}
      onconsider={(e) => (items = e.detail.items)}
      onfinalize={finalizeItems}
    >
      {#each items as item (item.id)}
        <GroupView group={item} {view} ondragging={(on) => (draggingTab = on)} />
      {/each}
    </div>

    {#if pageCount > 1}
      <nav class="pager" aria-label={t('pages')}>
        {#if pageStart > 0}
          <button class="link-button" onclick={() => (page = pageStart / PAGE_SIZE - 1)}>{t('previousPage', { n: PAGE_SIZE })}</button>
        {/if}
        <span class="meta">{t('pageRange', { from: pageStart + 1, to: Math.min(pageStart + PAGE_SIZE, groups.length), total: groups.length })}</span>
        {#if nextCount > 0}
          <button class="link-button" onclick={() => (page = pageStart / PAGE_SIZE + 1)}>{t('nextPage', { n: nextCount })}</button>
        {/if}
      </nav>
    {/if}

    <div class="drop-new-group" class:hidden={!draggingTab}>
      {#if draggingTab}<p class="meta">{t('dropNewGroup')}</p>{/if}
      <ul
        class="tabs"
        use:dndzone={{ items: newGroupItems, type: 'tab', flipDurationMs: FLIP_MS, ...DROP_TARGET }}
        onconsider={(e) => (newGroupItems = e.detail.items)}
        onfinalize={finalizeNewGroup}
      >
        {#each newGroupItems as t (t.id)}<li class="tab">{t.title}</li>{/each}
      </ul>
    </div>
  {/if}
</main>

{#if menuItem}
  {#key menuItem.id}<ItemMenu item={menuItem} {view} server={$account?.serverUrl} />{/key}
{/if}
<LocationDialog {view} />

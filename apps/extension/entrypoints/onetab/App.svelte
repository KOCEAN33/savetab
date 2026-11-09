<script lang="ts">
  import { liveQuery } from 'dexie';
  import { tick } from 'svelte';
  import { dndzone, dragHandleZone, setKeyboardDragTrigger, TRIGGERS, type DndEvent } from 'svelte-dnd-action';
  import { browser } from 'wxt/browser';
  import {
    copyItems,
    createFolder,
    emptyQuery,
    isActive,
    ListView,
    search,
    sortGroups,
    moveItems,
    moveToNewGroup,
    tabTitle,
    type Id,
    type Item,
    type ItemRecord,
    type SearchQuery,
    type SortKey,
    type Tab,
  } from '@savetab/core';
  import { db, transact } from '@/lib/db';
  import { DROP_TARGET, FLIP_MS } from '@/lib/motion';
  import { touchRecent } from '@/lib/recent';
  import { navigate } from '@/lib/keynav';
  import { editing, keys } from '@/lib/ui.svelte';
  import FolderRow from '@/components/FolderRow.svelte';
  import GroupView from '@/components/GroupView.svelte';
  import LocationDialog from '@/components/LocationDialog.svelte';
  import SelectionBar from '@/components/SelectionBar.svelte';
  import NavColumn from '@/components/NavColumn.svelte';
  import SearchBar from '@/components/SearchBar.svelte';
  import TasksView from '@/components/TasksView.svelte';
  import TrashView from '@/components/TrashView.svelte';

  // Enter stays free for opening links; Space starts a keyboard drag.
  setKeyboardDragTrigger('space');

  // Ceiling: the page reads every record on each change. Fine for tens of thousands of
  // tabs; switch to per-folder queries if large lists stutter.
  const records = liveQuery(() => db.items.toArray());

  let mode = $state<'list' | 'trash' | 'tasks'>('list');
  // The omnibox opens the page with ?q=<text>.
  let query = $state<SearchQuery>({ ...emptyQuery, text: new URLSearchParams(location.search).get('q') ?? '' });
  let draggingTab = $state(false);
  let current = $state<Id | null>(location.hash.slice(1) || null);

  const all = $derived(($records ?? []) as ItemRecord[]);
  const view = $derived(new ListView(all));
  // A folder trashed from another page or device sends this page back to the root.
  const folder = $derived(current && view.get(current)?.kind === 'folder' ? current : null);
  const trail = $derived(folder ? [...view.path(folder), view.get(folder)!] : []);
  const total = $derived(view.tabCount(null));
  const countAll = (id: string) => all.filter((r) => r.parentId === id && r.kind === 'tab' && !r.purged).length;
  const trashTitle = (r: ItemRecord) => tabTitle(r as Tab, view.link(r as Tab));

  const results = $derived(isActive(query) ? search(view, query) : null);
  const tasks = $derived(view.tasks());
  const pendingCount = $derived(tasks.filter((t) => t.task === 'pending').length);

  /** Items per page in a folder. A long folder pages with "Next {N}" and "Previous {N}". */
  const PAGE_SIZE = 50;
  let page = $state(0);
  $effect(() => {
    void folder;
    page = 0;
  });
  const children = $derived(view.children(folder));
  const pageCount = $derived(Math.max(1, Math.ceil(children.length / PAGE_SIZE)));
  const pageStart = $derived(Math.min(page, pageCount - 1) * PAGE_SIZE);
  /** The first item after this page: a drop at the page's end lands before it. */
  const afterPage = $derived(children[pageStart + PAGE_SIZE]?.id ?? null);
  const nextCount = $derived(Math.min(PAGE_SIZE, children.length - pageStart - PAGE_SIZE));

  let items = $derived(children.slice(pageStart, pageStart + PAGE_SIZE));
  /** Visible folders, groups, and tabs, top to bottom, for the tick menu's range commands. */
  const order = $derived(view.children(folder).flatMap((i) => [i.id, ...(i.kind === 'group' ? view.tabs(i.id).map((t) => t.id) : [])]));
  let newGroupItems = $state<Tab[]>([]);

  $effect(() => {
    history.replaceState(null, '', folder ? `#${folder}` : location.pathname);
  });

  function run<T>(fn: Parameters<typeof transact<T>>[0]): Promise<T | undefined> {
    return transact(fn).catch((err) => {
      items = children.slice(pageStart, pageStart + PAGE_SIZE);
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

  function finalizeItems(e: CustomEvent<DndEvent<Item>>) {
    items = e.detail.items;
    const { id, trigger } = e.detail.info;
    const copy = keys.copy;
    // A copy leaves the source in place, which the list's own data never stopped showing.
    if (copy || trigger !== TRIGGERS.DROPPED_INTO_ZONE) items = children.slice(pageStart, pageStart + PAGE_SIZE);
    if (trigger !== TRIGGERS.DROPPED_INTO_ZONE) return;
    const at = e.detail.items.findIndex((g) => g.id === id);
    if (at === -1) return;
    const before = e.detail.items[at + 1]?.id ?? afterPage;
    void run(async (tx) => {
      if (copy) await copyItems(tx, [id], folder, before);
      else await moveItems(tx, [id], folder, before);
    });
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

<div class="layout">
  <NavColumn {view} current={folder} onopen={open} />

  <main bind:this={mainEl}>
    <header class="page-header">
      <h1 class="page-total">Total: {total} {total === 1 ? 'tab' : 'tabs'}</h1>
      <nav class="page-nav">
        <button class="link-button" onclick={() => (mode = mode === 'tasks' ? 'list' : 'tasks')}>
          {mode === 'tasks' ? 'Back to list' : `Tasks (${pendingCount} pending, ${tasks.length - pendingCount} done)`}
        </button>
        <button class="link-button" onclick={() => (mode = mode === 'trash' ? 'list' : 'trash')}>
          {mode === 'trash' ? 'Back to list' : `Trash (${view.trashed.length})`}
        </button>
        <a class="link-button" href={browser.runtime.getURL('/import-export.html')}>Import / Export</a>
        <button class="link-button" onclick={() => browser.runtime.openOptionsPage()}>Options</button>
      </nav>
    </header>

    {#if mode === 'list'}
      <SearchBar bind:query {view} count={results?.count ?? null} />
    {/if}

    {#if mode === 'trash'}
      <TrashView trashed={view.trashed} tabCount={countAll} tabTitle={trashTitle} />
    {:else if mode === 'tasks'}
      <TasksView {tasks} {view} onopen={open} />
    {:else if results}
      <SelectionBar {view} order={results.groups.flatMap((r) => [r.group.id, ...r.tabs.map((t) => t.id)])} />
      {#each results.folders as f (f.id)}
        <FolderRow folder={f} {view} onopen={() => ((query = { ...emptyQuery }), open(f))} />
      {/each}
      {#each results.groups as r (r.group.id)}
        <GroupView group={r.group} {view} shown={r.tabs} ondragging={() => {}} />
      {/each}
    {:else}
      <div class="folder-bar">
        <nav class="breadcrumb" aria-label="Breadcrumb">
          <button class="link-button" onclick={() => open(null)}>All tabs</button>
          {#each trail as f (f.id)}
            <span class="meta">/</span>
            <button class="link-button" aria-current={f.id === folder ? 'page' : undefined} onclick={() => open(f)}
              >{f.title || 'Untitled folder'}</button
            >
          {/each}
        </nav>
        <button class="link-button" onclick={newFolder}>New folder</button>
        <select
          aria-label="Sort groups"
          value=""
          onchange={(e) => {
            const [key, dir] = e.currentTarget.value.split(':') as [SortKey, string];
            e.currentTarget.value = '';
            void run((tx) => sortGroups(tx, folder, key, dir === 'reverse'));
          }}
        >
          <option value="" disabled>Sort groups</option>
          <option value="title:">A-Z</option>
          <option value="title:reverse">Z-A</option>
          <option value="created:">Recently created</option>
          <option value="created:reverse">Least recently created</option>
          <option value="modified:">Recently modified</option>
          <option value="modified:reverse">Least recently modified</option>
          <option value="accessed:">Recently accessed</option>
          <option value="accessed:reverse">Least recently accessed</option>
        </select>
      </div>

      <SelectionBar {view} {order} />

      {#if items.length === 0}
        <p class="empty meta">
          {folder
            ? 'This folder is empty. Drag a group onto it in the folder column.'
            : 'When you have several tabs open, click the savetab icon in your browser toolbar. Your open tabs will appear here.'}
        </p>
      {/if}

      <div
        class="groups"
        use:dragHandleZone={{ items, type: 'group', flipDurationMs: FLIP_MS, useCursorForDetection: true, zoneTabIndex: -1, zoneItemTabIndex: -1, ...DROP_TARGET }}
        onconsider={(e) => (items = e.detail.items)}
        onfinalize={finalizeItems}
      >
        {#each items as item (item.id)}
          {#if item.kind === 'folder'}
            <FolderRow folder={item} {view} onopen={() => open(item)} />
          {:else if item.kind === 'group'}
            <GroupView group={item} {view} ondragging={(on) => (draggingTab = on)} />
          {/if}
        {/each}
      </div>

      {#if pageCount > 1}
        <nav class="pager" aria-label="Pages">
          {#if pageStart > 0}
            <button class="link-button" onclick={() => (page = pageStart / PAGE_SIZE - 1)}>Previous {PAGE_SIZE}</button>
          {/if}
          <span class="meta">{pageStart + 1}-{pageStart + items.length} of {children.length}</span>
          {#if nextCount > 0}
            <button class="link-button" onclick={() => (page = pageStart / PAGE_SIZE + 1)}>Next {nextCount}</button>
          {/if}
        </nav>
      {/if}

      <div class="drop-new-group" class:hidden={!draggingTab}>
        {#if draggingTab}<p class="meta">Drop here to create a new group</p>{/if}
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
</div>

<LocationDialog {view} />

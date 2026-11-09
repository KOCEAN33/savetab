<script lang="ts">
  import { liveQuery } from 'dexie';
  import { tick } from 'svelte';
  import { dndzone, dragHandleZone, setKeyboardDragTrigger, TRIGGERS, type DndEvent } from 'svelte-dnd-action';
  import { browser } from 'wxt/browser';
  import {
    createFolder,
    ListView,
    moveItems,
    moveToNewGroup,
    tabTitle,
    type Id,
    type Item,
    type ItemRecord,
    type Tab,
  } from '@savetab/core';
  import { db, transact } from '@/lib/db';
  import { DROP_TARGET, FLIP_MS } from '@/lib/motion';
  import { touchRecent } from '@/lib/recent';
  import FolderRow from '@/components/FolderRow.svelte';
  import GroupView from '@/components/GroupView.svelte';
  import NavColumn from '@/components/NavColumn.svelte';
  import TrashView from '@/components/TrashView.svelte';

  // Enter stays free for opening links; Space starts a keyboard drag.
  setKeyboardDragTrigger('space');

  // Ceiling: the page reads every record on each change. Fine for tens of thousands of
  // tabs; switch to per-folder queries if large lists stutter.
  const records = liveQuery(() => db.items.toArray());

  let showTrash = $state(false);
  let draggingTab = $state(false);
  let current = $state<Id | null>(location.hash.slice(1) || null);
  let editingFolder = $state<Id | null>(null);

  const all = $derived(($records ?? []) as ItemRecord[]);
  const view = $derived(new ListView(all));
  // A folder trashed from another page or device sends this page back to the root.
  const folder = $derived(current && view.get(current)?.kind === 'folder' ? current : null);
  const trail = $derived(folder ? [...view.path(folder), view.get(folder)!] : []);
  const total = $derived(view.tabCount(null));
  const countAll = (id: string) => all.filter((r) => r.parentId === id && r.kind === 'tab' && !r.purged).length;
  const trashTitle = (r: ItemRecord) => tabTitle(r as Tab, view.link(r as Tab));

  let items = $derived(view.children(folder));
  let newGroupItems = $state<Tab[]>([]);

  $effect(() => {
    history.replaceState(null, '', folder ? `#${folder}` : location.pathname);
  });

  function run<T>(fn: Parameters<typeof transact<T>>[0]): Promise<T | undefined> {
    return transact(fn).catch((err) => {
      items = view.children(folder);
      newGroupItems = [];
      alert(err instanceof Error ? err.message : String(err));
      return undefined;
    });
  }

  async function open(item: Item | null) {
    showTrash = false;
    if (item === null || item.kind === 'folder') {
      current = item?.id ?? null;
      if (item) void touchRecent(item.id);
      return;
    }
    current = item.parentId;
    await tick();
    document.getElementById(`item-${item.id}`)?.scrollIntoView({ block: 'start' });
  }

  async function newFolder() {
    const id = await run((tx) => createFolder(tx, folder, ''));
    if (id) editingFolder = id;
  }

  function finalizeItems(e: CustomEvent<DndEvent<Item>>) {
    items = e.detail.items;
    const { id, trigger } = e.detail.info;
    if (trigger !== TRIGGERS.DROPPED_INTO_ZONE) return;
    const at = items.findIndex((g) => g.id === id);
    if (at === -1) return;
    void run((tx) => moveItems(tx, [id], folder, items[at + 1]?.id ?? null));
  }

  function finalizeNewGroup(e: CustomEvent<DndEvent<Tab>>) {
    draggingTab = false;
    const { id, trigger } = e.detail.info;
    newGroupItems = [];
    if (trigger === TRIGGERS.DROPPED_INTO_ZONE) void run((tx) => moveToNewGroup(tx, [id], folder));
  }
</script>

<div class="layout">
  <NavColumn {view} current={folder} onopen={open} />

  <main>
    <header class="page-header">
      <h1 class="page-total">Total: {total} {total === 1 ? 'tab' : 'tabs'}</h1>
      <nav class="page-nav">
        <button class="link-button" onclick={() => (showTrash = !showTrash)}>
          {showTrash ? 'Back to list' : `Trash (${view.trashed.length})`}
        </button>
        <a class="link-button" href={browser.runtime.getURL('/import-export.html')}>Import / Export</a>
        <button class="link-button" onclick={() => browser.runtime.openOptionsPage()}>Options</button>
      </nav>
    </header>

    {#if showTrash}
      <TrashView trashed={view.trashed} tabCount={countAll} tabTitle={trashTitle} />
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
      </div>

      {#if items.length === 0}
        <p class="empty meta">
          {folder
            ? 'This folder is empty. Drag a group onto it in the folder column.'
            : 'When you have several tabs open, click the savetab icon in your browser toolbar. Your open tabs will appear here.'}
        </p>
      {/if}

      <div
        class="groups"
        use:dragHandleZone={{ items, type: 'group', flipDurationMs: FLIP_MS, useCursorForDetection: true, ...DROP_TARGET }}
        onconsider={(e) => (items = e.detail.items)}
        onfinalize={finalizeItems}
      >
        {#each items as item (item.id)}
          {#if item.kind === 'folder'}
            <FolderRow
              folder={item}
              {view}
              bind:editing={() => editingFolder === item.id, (on) => (editingFolder = on ? item.id : null)}
              onopen={() => open(item)}
            />
          {:else if item.kind === 'group'}
            <GroupView group={item} {view} ondragging={(on) => (draggingTab = on)} />
          {/if}
        {/each}
      </div>

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

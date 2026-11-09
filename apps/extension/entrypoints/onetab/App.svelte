<script lang="ts">
  import { liveQuery } from 'dexie';
  import { dndzone, dragHandleZone, setKeyboardDragTrigger, TRIGGERS, type DndEvent } from 'svelte-dnd-action';
  import { browser } from 'wxt/browser';
  import {
    compareSiblings,
    isLive,
    moveItems,
    moveToNewGroup,
    readSettings,
    SETTINGS_ID,
    type Group,
    type ItemRecord,
    type Tab,
  } from '@savetab/core';
  import { db, transact } from '@/lib/db';
  import { DROP_TARGET, FLIP_MS } from '@/lib/motion';
  import GroupView from '@/components/GroupView.svelte';
  import TrashView from '@/components/TrashView.svelte';

  // Enter stays free for opening links; Space starts a keyboard drag.
  setKeyboardDragTrigger('space');

  // Ceiling: the page reads every record on each change. Fine for tens of thousands of
  // tabs; switch to per-group queries if large lists stutter.
  const records = liveQuery(() => db.items.toArray());

  let showTrash = $state(false);
  let draggingTab = $state(false);

  const view = $derived.by(() => {
    const all = ($records ?? []) as ItemRecord[];
    const byParent = new Map<string, Tab[]>();
    const groups: Group[] = [];
    const trashed: ItemRecord[] = [];
    for (const r of all) {
      if (r.trashedAt != null && !r.purged) trashed.push(r);
      if (!isLive(r)) continue;
      if (r.kind === 'group' && r.parentId == null) groups.push(r as Group);
      if (r.kind === 'tab' && r.parentId) {
        const list = byParent.get(r.parentId) ?? [];
        list.push(r as Tab);
        byParent.set(r.parentId, list);
      }
    }
    groups.sort(compareSiblings);
    for (const list of byParent.values()) list.sort(compareSiblings);
    const liveGroups = groups.filter((g) => (byParent.get(g.id)?.length ?? 0) > 0 || g.title);
    const total = liveGroups.reduce((n, g) => n + (byParent.get(g.id)?.length ?? 0), 0);
    trashed.sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));
    const countAll = (id: string) => all.filter((r) => r.parentId === id && r.kind === 'tab' && !r.purged).length;
    return {
      groups: liveGroups,
      tabsOf: (id: string) => byParent.get(id) ?? [],
      total,
      trashed,
      countAll,
      settings: readSettings(all.find((r) => r.id === SETTINGS_ID)),
    };
  });

  let groupItems = $derived(view.groups);
  let newGroupItems = $state<Tab[]>([]);

  function run(fn: Parameters<typeof transact>[0]) {
    return transact(fn).catch((err) => {
      groupItems = view.groups;
      newGroupItems = [];
      alert(err instanceof Error ? err.message : String(err));
    });
  }

  function considerGroups(e: CustomEvent<DndEvent<Group>>) {
    groupItems = e.detail.items;
  }

  function finalizeGroups(e: CustomEvent<DndEvent<Group>>) {
    groupItems = e.detail.items;
    const { id, trigger } = e.detail.info;
    if (trigger !== TRIGGERS.DROPPED_INTO_ZONE) return;
    const at = groupItems.findIndex((g) => g.id === id);
    void run((tx) => moveItems(tx, [id], null, groupItems[at + 1]?.id ?? null));
  }

  function finalizeNewGroup(e: CustomEvent<DndEvent<Tab>>) {
    draggingTab = false;
    const { id, trigger } = e.detail.info;
    newGroupItems = [];
    if (trigger === TRIGGERS.DROPPED_INTO_ZONE) void run((tx) => moveToNewGroup(tx, [id]));
  }
</script>

<main>
  <header class="page-header">
    <h1 class="page-total">Total: {view.total} {view.total === 1 ? 'tab' : 'tabs'}</h1>
    <nav class="page-nav">
      <button class="link-button" onclick={() => (showTrash = !showTrash)}>
        {showTrash ? 'Back to list' : `Trash (${view.trashed.length})`}
      </button>
      <a class="link-button" href={browser.runtime.getURL('/import-export.html')}>Import / Export</a>
      <button class="link-button" onclick={() => browser.runtime.openOptionsPage()}>Options</button>
    </nav>
  </header>

  {#if showTrash}
    <TrashView trashed={view.trashed} tabCount={view.countAll} />
  {:else}
    {#if view.groups.length === 0}
      <p class="empty meta">
        When you have several tabs open, click the savetab icon in your browser toolbar. Your open tabs will appear here.
      </p>
    {/if}

    <div
      class="groups"
      use:dragHandleZone={{ items: groupItems, type: 'group', flipDurationMs: FLIP_MS, ...DROP_TARGET }}
      onconsider={considerGroups}
      onfinalize={finalizeGroups}
    >
      {#each groupItems as group (group.id)}
        <GroupView {group} tabs={view.tabsOf(group.id)} settings={view.settings} ondragging={(on) => (draggingTab = on)} />
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

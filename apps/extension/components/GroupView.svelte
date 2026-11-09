<script lang="ts">
  import { dndzone, dragHandle, TRIGGERS, type DndEvent } from 'svelte-dnd-action';
  import { moveItems, trashItems, updateItem, type Group, type ListView, type Tab } from '@savetab/core';
  import { transact } from '@/lib/db';
  import { DROP_TARGET, FLIP_MS } from '@/lib/motion';
  import { clickIntent, restoreGroup, restoreTab } from '@/lib/restore';
  import TabRow from './TabRow.svelte';

  let {
    group,
    view,
    ondragging,
  }: {
    group: Group;
    view: ListView;
    ondragging: (active: boolean) => void;
  } = $props();

  const tabs = $derived(view.tabs(group.id));
  const settings = $derived(view.settings);

  let items = $derived(tabs);
  let editing = $state(false);
  let draft = $state('');
  let menuOpen = $state(false);
  let menuAnchor = $state<HTMLElement>();

  const label = $derived(group.title || `${tabs.length} ${tabs.length === 1 ? 'tab' : 'tabs'}`);
  const created = $derived(new Date(group.createdAt).toLocaleString());

  function run(fn: Parameters<typeof transact>[0]) {
    return transact(fn).catch((err) => {
      items = tabs;
      alert(err instanceof Error ? err.message : String(err));
    });
  }

  function startEdit() {
    draft = group.title;
    editing = true;
    menuOpen = false;
  }

  function saveTitle() {
    if (!editing) return;
    editing = false;
    if (draft.trim() !== group.title) void run((tx) => updateItem(tx, group.id, { title: draft.trim() }));
  }

  function labelClick(e: MouseEvent) {
    if (settings.groupTitleClick === 'edit') startEdit();
    else void restoreGroup(tabs, clickIntent(e, settings), settings);
  }

  function menuAction(fn: () => unknown) {
    menuOpen = false;
    fn();
  }

  function consider(e: CustomEvent<DndEvent<Tab>>) {
    items = e.detail.items;
    if (e.detail.info.trigger === TRIGGERS.DRAG_STARTED) ondragging(true);
  }

  function finalize(e: CustomEvent<DndEvent<Tab>>) {
    items = e.detail.items;
    ondragging(false);
    const { id, trigger } = e.detail.info;
    if (trigger !== TRIGGERS.DROPPED_INTO_ZONE) return;
    const at = items.findIndex((t) => t.id === id);
    if (at === -1) return;
    void run((tx) => moveItems(tx, [id], group.id, items[at + 1]?.id ?? null));
  }
</script>

<svelte:window
  onclick={(e) => {
    if (menuOpen && !menuAnchor?.contains(e.target as Node)) menuOpen = false;
  }}
  onkeydown={(e) => {
    if (e.key === 'Escape') menuOpen = false;
  }}
/>

<section class="group" id="item-{group.id}" aria-label={label}>
  <div class="group-head">
    <span class="group-grip" use:dragHandle aria-label="Drag {label}">⠿</span>
    {#if editing}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="group-title-input"
        type="text"
        bind:value={draft}
        autofocus
        onblur={saveTitle}
        onkeydown={(e) => {
          if (e.key === 'Enter') saveTitle();
          if (e.key === 'Escape') editing = false;
        }}
      />
    {:else}
      <button class="group-label" onclick={labelClick}>{label}</button>
    {/if}
    {#if group.star}<span title="Starred">★</span>{/if}
    <span class="meta">{[group.pinnedTop && 'Pinned', group.locked && 'Locked', `Created ${created}`].filter(Boolean).join(', ')}</span>
    <button class="link-button" onclick={(e) => restoreGroup(tabs, clickIntent(e, settings), settings)}>Restore all</button>
    {#if !group.locked}
      <button class="link-button" onclick={() => run((tx) => trashItems(tx, [group.id]))}>Delete all</button>
    {/if}
    <span class="menu-anchor" bind:this={menuAnchor}>
    <button class="link-button" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>More…</button>
    {#if menuOpen}
      <div class="menu" role="menu">
        <button role="menuitem" onclick={startEdit}>Rename</button>
        <button role="menuitem" onclick={() => menuAction(() => run((tx) => updateItem(tx, group.id, { locked: !group.locked })))}>
          {group.locked ? 'Unlock this tab group' : 'Lock this tab group'}
        </button>
        <button role="menuitem" onclick={() => menuAction(() => run((tx) => updateItem(tx, group.id, { star: !group.star })))}>
          {group.star ? 'Remove star' : 'Star this tab group'}
        </button>
        <button
          role="menuitem"
          onclick={() => menuAction(() => run((tx) => updateItem(tx, group.id, { pinnedTop: !group.pinnedTop })))}
        >
          {group.pinnedTop ? 'Unpin' : 'Pin to top of list'}
        </button>
        {#if !group.locked}
          <button role="menuitem" onclick={() => menuAction(() => run((tx) => trashItems(tx, [group.id])))}>Move to trash</button>
        {/if}
      </div>
    {/if}
    </span>
  </div>

  <ul
    class="tabs"
    use:dndzone={{
      items,
      type: 'tab',
      flipDurationMs: FLIP_MS,
      ...DROP_TARGET,
      dragDisabled: group.locked,
      dropFromOthersDisabled: group.locked,
    }}
    onconsider={consider}
    onfinalize={finalize}
  >
    {#each items as tab (tab.id)}
      <TabRow
        {tab}
        title={view.title(tab)}
        {settings}
        locked={group.locked}
        onopen={(e) => restoreTab(tab, clickIntent(e, settings))}
        ondelete={() => run((tx) => trashItems(tx, [tab.id]))}
      />
    {/each}
  </ul>
</section>

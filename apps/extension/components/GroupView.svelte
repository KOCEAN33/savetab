<script lang="ts">
  import { dndzone, dragHandle, TRIGGERS, type DndEvent } from 'svelte-dnd-action';
  import {
    copyItems,
    moveItems,
    trashItems,
    updateItem,
    type Group,
    type ListView,
    type Tab,
  } from '@savetab/core';
  import { DROP_TARGET, FLIP_MS } from '@/lib/motion';
  import { clickIntent, restoreGroup, restoreTab } from '@/lib/restore';
  import { act, editing, keys } from '@/lib/ui.svelte';
  import ItemMenu from './ItemMenu.svelte';
  import NotesField from './NotesField.svelte';
  import TabRow from './TabRow.svelte';
  import Tick from './Tick.svelte';
  import TitleField from './TitleField.svelte';

  let {
    group,
    view,
    ondragging,
    shown,
  }: {
    group: Group;
    view: ListView;
    ondragging: (active: boolean) => void;
    /** Search results show only the matching tabs, and dragging is off. */
    shown?: Tab[];
  } = $props();

  const tabs = $derived(shown ?? view.tabs(group.id));
  const settings = $derived(view.settings);

  let items = $derived(tabs);

  const count = $derived(view.tabs(group.id).length);
  const label = $derived(group.title || `${count} ${count === 1 ? 'tab' : 'tabs'}`);
  const created = $derived(new Date(group.createdAt).toLocaleString());

  function run(fn: Parameters<typeof act>[0]) {
    return act(fn).finally(() => (items = tabs));
  }

  function labelClick(e: MouseEvent) {
    if (settings.groupTitleClick === 'edit') editing.title = group.id;
    else void restoreGroup(tabs, clickIntent(e, settings), settings);
  }

  function consider(e: CustomEvent<DndEvent<Tab>>) {
    items = e.detail.items;
    if (e.detail.info.trigger === TRIGGERS.DRAG_STARTED) ondragging(true);
  }

  function finalize(e: CustomEvent<DndEvent<Tab>>) {
    items = e.detail.items;
    ondragging(false);
    const { id, trigger } = e.detail.info;
    const copy = keys.copy;
    // A copy leaves the source in place, which the group's own data never stopped showing.
    if (copy) items = tabs;
    if (trigger !== TRIGGERS.DROPPED_INTO_ZONE) return;
    const at = e.detail.items.findIndex((t) => t.id === id);
    if (at === -1) return;
    const before = e.detail.items[at + 1]?.id ?? null;
    void run((tx) => (copy ? copyItems(tx, [id], group.id, before) : moveItems(tx, [id], group.id, before)));
  }
</script>

<section class="group" class:archived={group.archived} id="item-{group.id}" aria-label={label}>
  <div class="group-head">
    <span class="group-grip" use:dragHandle aria-label="Drag {label}">⠿</span>
    <Tick id={group.id} {label} />
    {#if group.task !== 'none'}
      <input
        type="checkbox"
        aria-label="Task done"
        checked={group.task === 'done'}
        onchange={(e) => {
        const task = e.currentTarget.checked ? 'done' : 'pending';
        void act((tx) => updateItem(tx, group.id, { task }));
      }}
      />
    {/if}
    {#if editing.title === group.id}
      <TitleField item={group} title={group.title} label="Group name" />
    {:else}
      <button class="group-label" onclick={labelClick}>{label}</button>
    {/if}
    {#if group.star}<span title="Starred">★</span>{/if}
    <span class="meta"
      >{[group.pinnedTop && 'Pinned', group.locked && 'Locked', group.archived && 'Archived', `Created ${created}`]
        .filter(Boolean)
        .join(', ')}</span
    >
    <button class="link-button" onclick={(e) => restoreGroup(tabs, clickIntent(e, settings), settings)}>Restore all</button>
    {#if !group.locked}
      <button class="link-button" onclick={() => run((tx) => trashItems(tx, [group.id]))}>Delete all</button>
    {/if}
    <ItemMenu item={group} {view} />
  </div>
  {#if editing.notes === group.id}
    <NotesField item={group} notes={group.notes} />
  {:else if group.notes}
    <p class="notes meta">{group.notes}</p>
  {/if}

  <ul
    class="tabs"
    use:dndzone={{
      items,
      type: 'tab',
      flipDurationMs: FLIP_MS,
      ...DROP_TARGET,
      dragDisabled: group.locked || shown !== undefined,
      dropFromOthersDisabled: group.locked,
    }}
    onconsider={consider}
    onfinalize={finalize}
  >
    {#each items as tab (tab.id)}
      <TabRow
        {tab}
        {view}
        locked={group.locked}
        onopen={(e) => restoreTab(tab, clickIntent(e, settings))}
        ondelete={() => run((tx) => trashItems(tx, [tab.id]))}
      />
    {/each}
  </ul>
</section>

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
  import { clickSelect } from '@/lib/row-select';
  import { activeShare } from '@/lib/share';
  import { act, editing, keys, menu, toggleMenu } from '@/lib/ui.svelte';
  import { shortDate, t, tn } from '@/lib/i18n';
  import Icon from './Icon.svelte';
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
  const label = $derived(group.title || tn('tabCount', count));
  const shared = $derived(activeShare(group));
  const created = $derived(t('createdAt', { date: new Date(group.createdAt).toLocaleString() }));
  const meta = $derived(
    [
      group.title && tn('tabCount', count),
      shortDate(group.createdAt),
      group.pinnedTop && t('pinned'),
      group.locked && t('locked'),
      shared && t('sharedUntil', { date: shortDate(shared.expiresAt) }),
    ]
      .filter(Boolean)
      .join(' · '),
  );

  function run(fn: Parameters<typeof act>[0]) {
    return act(fn).finally(() => (items = tabs));
  }

  function labelClick(e: MouseEvent) {
    if (clickSelect(e, group.id)) return;
    if (settings.groupTitleClick === 'edit') editing.title = group.id;
    else void restoreGroup(tabs, clickIntent(e, settings), settings, group);
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

<section class="group" id="item-{group.id}" aria-label={label}>
  <div class="group-head" tabindex="0" role="treeitem" aria-selected="false" aria-expanded={!group.collapsed} aria-label={label} data-nav="group" data-id={group.id}>
    <Tick id={group.id} {label} />
    {#if editing.title === group.id}
      <TitleField item={group} title={group.title} label={t('groupName')} />
    {:else}
      <button class="group-label" onclick={labelClick}>{label}</button>
    {/if}
    {#if group.star}<span class="star" title={t('starred')}><Icon name="star" /></span>{/if}
    <span class="meta" title={created}>{meta}</span>
    <span class="group-drag" use:dragHandle aria-label={t('dragItem', { name: label })}></span>
    <span class="group-actions">
      {#if !group.locked}
        <button class="link-button delete-all" onclick={() => act((tx) => trashItems(tx, [group.id]))}>{t('deleteAll')}</button>
      {/if}
      <button class="link-button restore-all" onclick={(e) => restoreGroup(tabs, clickIntent(e, settings), settings, group)}
        >{t('restoreAll')}</button
      >
      <button
        class="icon-button"
        title={t('menuMore')}
        aria-label={t('menuMore')}
        aria-haspopup="menu"
        aria-expanded={menu.id === group.id}
        onclick={(e) => toggleMenu(group.id, e.currentTarget)}><Icon name="more" /></button
      >
      <button
        class="icon-button"
        class:collapsed={group.collapsed}
        title={group.collapsed ? t('expand') : t('collapse')}
        aria-label={group.collapsed ? t('expand') : t('collapse')}
        aria-expanded={!group.collapsed}
        onclick={() => act((tx) => updateItem(tx, group.id, { collapsed: !group.collapsed }))}><Icon name="chevron" /></button
      >
    </span>
  </div>
  {#if editing.notes === group.id}
    <NotesField item={group} notes={group.notes} />
  {:else if group.notes}
    <p class="notes meta">{group.notes}</p>
  {/if}

  {#if !group.collapsed}
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
  {/if}
</section>

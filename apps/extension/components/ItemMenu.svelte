<script lang="ts">
  import {
    addToQuickList,
    createNear,
    mergeInnerGroups,
    mergeIntoParent,
    removeDuplicates,
    removeFromQuickList,
    trashItems,
    updateItem,
    type DuplicateScope,
    type Item,
    type ListView,
    type Placement,
    type TaskState,
  } from '@savetab/core';
  import { copyLinks } from '@/lib/clipboard';
  import { act, chooser, editing } from '@/lib/ui.svelte';
  import { t } from '@/lib/i18n';

  let {
    item,
    view,
    label = t('menuMore'),
    buttonClass = 'link-button',
    ariaLabel,
  }: { item: Item; view: ListView; label?: string; buttonClass?: string; ariaLabel?: string } = $props();

  let open = $state(false);
  let anchor = $state<HTMLElement>();

  const locked = $derived(item.kind === 'group' && item.locked);

  function close(fn: () => unknown) {
    open = false;
    fn();
  }

  const set = (patch: Record<string, unknown>) => close(() => act((tx) => updateItem(tx, item.id, patch)));

  function create(kind: 'folder' | 'group', where: Placement) {
    close(async () => {
      const id = await act((tx) => createNear(tx, kind, item.id, where));
      if (id) editing.title = id;
    });
  }

  function dedupe(scope: DuplicateScope) {
    close(async () => {
      const n = await act((tx) => removeDuplicates(tx, item.id, scope));
      if (n === 0) alert(t('noDuplicates'));
    });
  }

  const TASK_NEXT: Record<TaskState, [TaskState, string]> = {
    none: ['pending', t('menuMakeTask')],
    pending: ['done', t('menuMarkTaskDone')],
    done: ['pending', t('menuMarkTaskNotDone')],
  };
</script>

<svelte:window
  onclick={(e) => {
    if (open && !anchor?.contains(e.target as Node)) open = false;
  }}
  onkeydown={(e) => {
    if (e.key === 'Escape') open = false;
  }}
/>

<span class="menu-anchor" bind:this={anchor}>
  <button class={buttonClass} aria-expanded={open} aria-label={ariaLabel} onclick={() => (open = !open)}>{label}</button>
  {#if open}
    <div class="menu" role="menu">
      <button role="menuitem" onclick={() => close(() => (editing.title = item.id))}>{t('menuRename')}</button>
      <button role="menuitem" onclick={() => close(() => (editing.notes = item.id))}>
        {view.notes(item) ? t('menuEditNote') : t('menuAddNote')}
      </button>
      {#if item.kind === 'group'}
        <button role="menuitem" onclick={() => set({ locked: !item.locked })}>
          {item.locked ? t('menuUnlockGroup') : t('menuLockGroup')}
        </button>
      {/if}
      {#if item.kind !== 'folder'}
        <button role="menuitem" onclick={() => set({ star: !item.star })}>
          {item.star ? t('menuRemoveStar') : item.kind === 'group' ? t('menuStarGroup') : t('menuStarTab')}
        </button>
        <button role="menuitem" onclick={() => set({ task: TASK_NEXT[item.task][0] })}>{TASK_NEXT[item.task][1]}</button>
        {#if item.task !== 'none'}
          <button role="menuitem" onclick={() => set({ task: 'none' })}>{t('menuRemoveTask')}</button>
        {/if}
        <button role="menuitem" onclick={() => set({ archived: !item.archived })}>
          {item.archived ? t('menuUnarchive') : t('menuMarkArchived')}
        </button>
        {#if item.quickOrder == null}
          <button
            role="menuitem"
            onclick={() => close(() => act((tx) => addToQuickList(tx, item.id, view.quickList().at(-1)?.id ?? null)))}
            >{t('menuAddQuickList')}</button
          >
        {:else}
          <button role="menuitem" onclick={() => close(() => act((tx) => removeFromQuickList(tx, item.id)))}>
            {t('menuRemoveQuickList')}
          </button>
        {/if}
      {/if}
      {#if item.kind !== 'tab'}
        <button role="menuitem" onclick={() => set({ pinnedTop: !item.pinnedTop })}>
          {item.pinnedTop ? t('menuUnpin') : t('menuPinTop')}
        </button>
        <hr />
        <button role="menuitem" onclick={() => create('group', 'above')}>{t('menuCreateGroupAbove')}</button>
        <button role="menuitem" onclick={() => create('group', 'below')}>{t('menuCreateGroupBelow')}</button>
        <button role="menuitem" onclick={() => create('folder', 'above')}>{t('menuCreateFolderAbove')}</button>
        <button role="menuitem" onclick={() => create('folder', 'below')}>{t('menuCreateFolderBelow')}</button>
        {#if item.kind === 'folder'}
          <button role="menuitem" onclick={() => create('group', 'within')}>{t('menuCreateGroupWithin')}</button>
          <button role="menuitem" onclick={() => create('folder', 'within')}>{t('menuCreateFolderWithin')}</button>
          <hr />
          <button role="menuitem" onclick={() => close(() => act((tx) => mergeIntoParent(tx, item.id)))}>
            {t('menuMergeIntoParent')}
          </button>
          <button role="menuitem" onclick={() => close(() => act((tx) => mergeInnerGroups(tx, item.id)))}>
            {t('menuMergeInnerGroups')}
          </button>
        {/if}
        <hr />
        <button role="menuitem" onclick={() => dedupe('within')}>{t('menuDedupeWithin')}</button>
        <button role="menuitem" onclick={() => dedupe('hereElsewhere')}>{t('menuDedupeHereElsewhere')}</button>
        <button role="menuitem" onclick={() => dedupe('elsewhereHere')}>{t('menuDedupeElsewhereHere')}</button>
      {/if}
      <hr />
      {#if !locked}
        <button role="menuitem" onclick={() => close(() => Object.assign(chooser, { ids: [item.id], mode: 'move' }))}>
          {t('menuMove')}
        </button>
      {/if}
      <button role="menuitem" onclick={() => close(() => Object.assign(chooser, { ids: [item.id], mode: 'copy' }))}>
        {t('menuCopy')}
      </button>
      <button role="menuitem" onclick={() => close(() => copyLinks(view, [item]))}>
        {item.kind === 'tab' ? t('menuCopyLink') : t('menuCopyLinks')}
      </button>
      {#if !locked}
        <button role="menuitem" onclick={() => close(() => act((tx) => trashItems(tx, [item.id])))}>{t('moveToTrash')}</button>
      {/if}
    </div>
  {/if}
</span>

<script lang="ts">
  import {
    createNear,
    mergeInnerGroups,
    mergeIntoParent,
    removeDuplicates,
    trashItems,
    updateItem,
    type DuplicateScope,
    type Item,
    type ListView,
    type Placement,
    type TaskState,
  } from '@savetab/core';
  import { copyLinks } from '@/lib/clipboard';
  import { act, editing } from '@/lib/ui.svelte';

  let {
    item,
    view,
    label = 'More…',
    buttonClass = 'link-button',
    ariaLabel,
  }: { item: Item; view: ListView; label?: string; buttonClass?: string; ariaLabel?: string } = $props();

  let open = $state(false);
  let anchor = $state<HTMLElement>();

  const noun = $derived(item.kind === 'group' ? 'tab group' : item.kind);
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
      if (n === 0) alert('No duplicates found.');
    });
  }

  const TASK_NEXT: Record<TaskState, [TaskState, string]> = {
    none: ['pending', 'Make this a task'],
    pending: ['done', 'Mark task done'],
    done: ['pending', 'Mark task not done'],
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
      <button role="menuitem" onclick={() => close(() => (editing.title = item.id))}>Rename</button>
      <button role="menuitem" onclick={() => close(() => (editing.notes = item.id))}>
        {view.notes(item) ? 'Edit note' : 'Add note'}
      </button>
      {#if item.kind === 'group'}
        <button role="menuitem" onclick={() => set({ locked: !item.locked })}>
          {item.locked ? 'Unlock this tab group' : 'Lock this tab group'}
        </button>
      {/if}
      {#if item.kind !== 'folder'}
        <button role="menuitem" onclick={() => set({ star: !item.star })}>
          {item.star ? 'Remove star' : `Star this ${noun}`}
        </button>
        <button role="menuitem" onclick={() => set({ task: TASK_NEXT[item.task][0] })}>{TASK_NEXT[item.task][1]}</button>
        {#if item.task !== 'none'}
          <button role="menuitem" onclick={() => set({ task: 'none' })}>Remove task</button>
        {/if}
        <button role="menuitem" onclick={() => set({ archived: !item.archived })}>
          {item.archived ? 'Unarchive' : 'Mark as archived'}
        </button>
      {/if}
      {#if item.kind !== 'tab'}
        <button role="menuitem" onclick={() => set({ pinnedTop: !item.pinnedTop })}>
          {item.pinnedTop ? 'Unpin' : 'Pin to top of list'}
        </button>
        <hr />
        <button role="menuitem" onclick={() => create('group', 'above')}>Create group above</button>
        <button role="menuitem" onclick={() => create('group', 'below')}>Create group below</button>
        <button role="menuitem" onclick={() => create('folder', 'above')}>Create folder above</button>
        <button role="menuitem" onclick={() => create('folder', 'below')}>Create folder below</button>
        {#if item.kind === 'folder'}
          <button role="menuitem" onclick={() => create('group', 'within')}>Create group within</button>
          <button role="menuitem" onclick={() => create('folder', 'within')}>Create folder within</button>
          <hr />
          <button role="menuitem" onclick={() => close(() => act((tx) => mergeIntoParent(tx, item.id)))}>
            Merge into parent
          </button>
          <button role="menuitem" onclick={() => close(() => act((tx) => mergeInnerGroups(tx, item.id)))}>
            Merge with inner groups
          </button>
        {/if}
        <hr />
        <button role="menuitem" onclick={() => dedupe('within')}>Remove duplicates within here</button>
        <button role="menuitem" onclick={() => dedupe('hereElsewhere')}>Remove duplicates here that exist elsewhere</button>
        <button role="menuitem" onclick={() => dedupe('elsewhereHere')}>Remove duplicates elsewhere that exist here</button>
      {/if}
      <hr />
      <button role="menuitem" onclick={() => close(() => copyLinks(view, [item]))}>
        {item.kind === 'tab' ? 'Copy link to clipboard' : 'Copy links to clipboard'}
      </button>
      {#if !locked}
        <button role="menuitem" onclick={() => close(() => act((tx) => trashItems(tx, [item.id])))}>Move to trash</button>
      {/if}
    </div>
  {/if}
</span>

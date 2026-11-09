<script lang="ts">
  import { trashItems, updateItem, type Id, type Item, type ListView, type Tab } from '@savetab/core';
  import { copyLinks } from '@/lib/clipboard';
  import { clickIntent, restoreSelected } from '@/lib/restore';
  import { selectCommand, type SelectCommand } from '@/lib/selection';
  import { act, chooser, selectMenu, selection } from '@/lib/ui.svelte';

  let { view, order }: { view: ListView; order: Id[] } = $props();

  const items = $derived([...selection].flatMap((id) => view.get(id) ?? []));

  /** Tabs of the selection, each once, in list order. */
  const tabs = $derived.by(() => {
    const seen = new Set<Id>();
    const out: Tab[] = [];
    const add = (t: Tab) => !seen.has(t.id) && (seen.add(t.id), out.push(t));
    for (const item of items) {
      if (item.kind === 'tab') add(item);
      else for (const g of item.kind === 'group' ? [item] : view.groups(item.id)) view.tabs(g.id).forEach(add);
    }
    return out;
  });

  function done(fn: () => unknown) {
    fn();
    selection.clear();
  }

  function setAll(patch: Record<string, unknown>) {
    const ids = items.filter((i) => i.kind !== 'folder').map((i) => i.id);
    done(() =>
      act(async (tx) => {
        for (const id of ids) await updateItem(tx, id, patch);
      }),
    );
  }

  function trash() {
    const ids = items.map((i) => i.id);
    done(() => act((tx) => trashItems(tx, ids)));
  }

  function choose(mode: 'move' | 'copy') {
    const kinds = new Set(items.map((i: Item) => i.kind === 'tab'));
    if (kinds.size > 1) {
      alert('Select only tabs, or only groups and folders, to move or copy them together.');
      return;
    }
    done(() => Object.assign(chooser, { ids: items.map((i) => i.id), mode }));
  }

  function command(c: SelectCommand) {
    const next = selectCommand(c, order, selection, selectMenu.id!);
    selection.clear();
    for (const id of next) selection.add(id);
    selectMenu.id = null;
  }

  const COMMANDS: [SelectCommand, string][] = [
    ['all', 'Select all'],
    ['none', 'Deselect all'],
    ['invert', 'Invert selection'],
    ['allExcept', 'Select all except this'],
    ['thisAndAbove', 'Select this and above'],
    ['thisAndBelow', 'Select this and below'],
  ];
</script>

<svelte:window
  onclick={(e) => {
    if (selectMenu.id && !(e.target as Element).closest('.select-menu')) selectMenu.id = null;
  }}
  onkeydown={(e) => {
    if (e.key === 'Escape') selectMenu.id = null;
  }}
/>

{#if selectMenu.id}
  <div class="menu select-menu" role="menu" style:left="{selectMenu.x}px" style:top="{selectMenu.y}px">
    {#each COMMANDS as [c, label] (c)}
      <button role="menuitem" onclick={() => command(c)}>{label}</button>
    {/each}
  </div>
{/if}

{#if items.length > 0}
  <div class="selection-bar" role="toolbar" aria-label="Selection">
    <span>{items.length} selected</span>
    <button class="link-button" onclick={(e) => done(() => restoreSelected(tabs, clickIntent(e, view.settings), view.settings))}>
      Restore
    </button>
    <button class="link-button" onclick={() => choose('move')}>Move…</button>
    <button class="link-button" onclick={() => choose('copy')}>Copy…</button>
    <button class="link-button" onclick={() => setAll({ star: true })}>Star</button>
    <button class="link-button" onclick={() => setAll({ archived: true })}>Archive</button>
    <button class="link-button" onclick={() => setAll({ task: 'pending' })}>Make task</button>
    <button class="link-button" onclick={() => copyLinks(view, items)}>Copy links</button>
    <button class="link-button" onclick={trash}>Move to trash</button>
    <button class="link-button" onclick={() => selection.clear()}>Clear</button>
  </div>
{/if}

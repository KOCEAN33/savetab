<script lang="ts">
  import { dndzone, TRIGGERS, type DndEvent } from 'svelte-dnd-action';
  import { mergeGroups, moveItems, type Id, type Item, type ListView } from '@savetab/core';
  import { act } from '@/lib/ui.svelte';
  import { DROP_TARGET } from '@/lib/motion';
  import { navFilterItem, recentItem, type NavFilter } from '@/lib/recent';

  let {
    view,
    current,
    onopen,
  }: {
    view: ListView;
    current: Id | null;
    onopen: (item: Item | null) => void;
  } = $props();

  let filter = $state<NavFilter>('all');
  let recent = $state<Id[]>([]);
  void navFilterItem.getValue().then((v) => (filter = v));
  void recentItem.getValue().then((v) => (recent = v));
  recentItem.watch((v) => (recent = v ?? []));

  const quick = $derived(view.quickList());

  /** Drop zones hold only the dragged group's placeholder while it hovers. */
  let drops = $state<Record<string, Item[]>>({});

  const shown = (item: Item) =>
    item.kind === 'folder' || (filter === 'all' && item.kind === 'group') || (filter === 'named' && item.title !== '');

  function label(item: Item): string {
    if (item.kind === 'folder') return item.title || 'Untitled folder';
    if (item.kind === 'tab') return view.title(item) || item.url;
    const n = view.tabs(item.id).length;
    return item.title || `${n} ${n === 1 ? 'tab' : 'tabs'}`;
  }

  /** A group dropped on a folder moves into it. A group dropped on a group merges into it. */
  function finalize(targetId: Id | null, e: CustomEvent<DndEvent<Item>>) {
    drops[targetId ?? ''] = [];
    const { id, trigger } = e.detail.info;
    if (trigger !== TRIGGERS.DROPPED_INTO_ZONE || id === targetId) return;
    const target = targetId === null ? null : view.get(targetId);
    if (target?.kind === 'group') {
      if (view.get(id)?.kind === 'group') void act((tx) => mergeGroups(tx, id, target.id));
      return;
    }
    const first = view.children(targetId)[0]?.id ?? null;
    void act((tx) => moveItems(tx, [id], targetId, first === id ? null : first));
  }
</script>

<!-- A drop zone overlays a folder's or group's label. It ignores the pointer, so the label stays clickable,
     while svelte-dnd-action finds zones by their rectangles. -->
{#snippet dropZone(folderId: Id | null)}
  <div
    class="nav-drop"
    use:dndzone={{ items: drops[folderId ?? ''] ?? [], type: 'group', flipDurationMs: 0, ...DROP_TARGET }}
    onconsider={(e) => (drops[folderId ?? ''] = e.detail.items)}
    onfinalize={(e) => finalize(folderId, e)}
  >
    {#each drops[folderId ?? ''] ?? [] as d (d.id)}<span></span>{/each}
  </div>
{/snippet}

{#snippet tree(parentId: Id | null)}
  <ul class="nav-tree">
    {#each view.children(parentId).filter(shown) as item (item.id)}
      <li class="nav-entry">
        <button
          class="link-button nav-item"
          class:nav-current={item.id === current}
          aria-current={item.id === current ? 'page' : undefined}
          onclick={() => onopen(item)}>{label(item)}</button
        >
        {#if item.kind !== 'group' || !item.locked}{@render dropZone(item.id)}{/if}
        {#if item.kind === 'folder' && !item.collapsed}{@render tree(item.id)}{/if}
      </li>
    {/each}
  </ul>
{/snippet}

<nav class="nav-column" aria-label="Folders">
  <div class="nav-entry">
    <button class="link-button nav-item" class:nav-current={current === null} onclick={() => onopen(null)}>All tabs</button>
    {@render dropZone(null)}
  </div>
  {@render tree(null)}

  {#if quick.length > 0}
    <h2 class="nav-heading">Quick list</h2>
    <ul class="nav-tree" aria-label="Quick list">
      {#each quick as item (item.id)}
        <li><button class="link-button nav-item" onclick={() => onopen(item)}>{label(item)}</button></li>
      {/each}
    </ul>
  {/if}

  {#if recent.some((id) => view.get(id))}
    <h2 class="nav-heading">Recent</h2>
    <ul class="nav-tree">
      {#each recent.flatMap((id) => view.get(id) ?? []) as item (item.id)}
        <li><button class="link-button nav-item" onclick={() => onopen(item)}>{label(item)}</button></li>
      {/each}
    </ul>
  {/if}

  <label class="nav-filter meta">
    Show
    <select
      bind:value={filter}
      onchange={() => void navFilterItem.setValue(filter)}
    >
      <option value="all">everything</option>
      <option value="folders">folders only</option>
      <option value="named">named only</option>
    </select>
  </label>
</nav>

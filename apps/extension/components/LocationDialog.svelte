<script lang="ts">
  import { copyItems, moveItems, type Id, type Item, type ListView } from '@savetab/core';
  import { touchRecent } from '@/lib/recent';
  import { act, chooser } from '@/lib/ui.svelte';

  let { view }: { view: ListView } = $props();

  let dialog = $state<HTMLDialogElement>();
  let query = $state('');

  interface Target {
    id: Id | null;
    path: string;
  }

  function label(item: Item): string {
    if (item.kind === 'folder') return item.title || 'Untitled folder';
    const n = view.tabs(item.id).length;
    return item.title || `${n} ${n === 1 ? 'tab' : 'tabs'}`;
  }

  /** Tabs go into groups. Groups and folders go into folders, never into themselves. */
  const targets = $derived.by(() => {
    if (!chooser.mode) return [];
    const tabsOnly = chooser.ids.every((id) => view.get(id)?.kind === 'tab');
    const moving = new Set(chooser.ids);
    const out: Target[] = tabsOnly ? [] : [{ id: null, path: 'All tabs' }];
    const walk = (parentId: Id | null, prefix: string) => {
      for (const item of view.children(parentId)) {
        if (item.kind === 'tab' || moving.has(item.id)) continue;
        const path = prefix ? `${prefix} / ${label(item)}` : label(item);
        if (item.kind === 'folder') {
          if (!tabsOnly) out.push({ id: item.id, path });
          walk(item.id, path);
        } else if (tabsOnly && !item.locked) {
          out.push({ id: item.id, path });
        }
      }
    };
    walk(null, '');
    const q = query.trim().toLowerCase();
    return q ? out.filter((t) => t.path.toLowerCase().includes(q)) : out;
  });

  $effect(() => {
    if (chooser.mode && !dialog?.open) {
      query = '';
      dialog?.showModal();
    }
  });

  function close() {
    chooser.mode = null;
    chooser.ids = [];
    dialog?.close();
  }

  async function choose(target: Id | null) {
    const { ids, mode } = chooser;
    close();
    const first = view.children(target)[0]?.id ?? null;
    await act(async (tx) => {
      if (mode === 'copy') await copyItems(tx, ids, target, first);
      else await moveItems(tx, ids, target, first);
    });
    if (target && view.get(target)?.kind === 'group') void touchRecent(target);
  }
</script>

<dialog class="dialog" bind:this={dialog} aria-label={chooser.mode === 'copy' ? 'Copy to' : 'Move to'} onclose={close}>
  <h2 class="section-title">{chooser.mode === 'copy' ? 'Copy to' : 'Move to'}</h2>
  <input type="text" aria-label="Find a location" placeholder="Find a location" bind:value={query} />
  <ul class="dialog-list">
    {#each targets as t (t.id ?? '')}
      <li><button class="link-button" onclick={() => choose(t.id)}>{t.path}</button></li>
    {:else}
      <li class="meta">No matching location.</li>
    {/each}
  </ul>
  <button class="button" onclick={close}>Cancel</button>
</dialog>

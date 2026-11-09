<script lang="ts">
  import { updateItem, type Group, type Item, type ListView, type Tab } from '@savetab/core';
  import { act } from '@/lib/ui.svelte';

  let { tasks, view, onopen }: { tasks: (Group | Tab)[]; view: ListView; onopen: (item: Item) => void } = $props();

  function label(item: Group | Tab): string {
    if (item.kind === 'tab') return view.title(item) || item.url;
    const n = view.tabs(item.id).length;
    return item.title || `${n} ${n === 1 ? 'tab' : 'tabs'}`;
  }
</script>

<section aria-label="Tasks">
  {#if tasks.length === 0}
    <p class="meta">No tasks.</p>
  {:else}
    <ul class="tabs">
      {#each tasks as item (item.id)}
        <li class="tab" class:archived={item.archived}>
          <input
            type="checkbox"
            aria-label="Task done"
            checked={item.task === 'done'}
            onchange={(e) => {
              const task = e.currentTarget.checked ? 'done' : 'pending';
              void act((tx) => updateItem(tx, item.id, { task }));
            }}
          />
          <button class="link-button" onclick={() => onopen(item)}>{label(item)}</button>
          <span class="meta">{item.kind === 'group' ? 'Tab group' : 'Tab'}</span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

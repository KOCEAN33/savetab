<script lang="ts">
  import { updateItem, type Group, type Item, type ListView, type Tab } from '@savetab/core';
  import { act } from '@/lib/ui.svelte';
  import { t, tn } from '@/lib/i18n';

  let { tasks, view, onopen }: { tasks: (Group | Tab)[]; view: ListView; onopen: (item: Item) => void } = $props();

  function label(item: Group | Tab): string {
    if (item.kind === 'tab') return view.title(item) || item.url;
    const n = view.tabs(item.id).length;
    return item.title || tn('tabCount', n);
  }
</script>

<section aria-label={t('tasks')}>
  {#if tasks.length === 0}
    <p class="meta">{t('noTasks')}</p>
  {:else}
    <ul class="tabs">
      {#each tasks as item (item.id)}
        <li class="tab" class:archived={item.archived}>
          <input
            type="checkbox"
            aria-label={t('taskDone')}
            checked={item.task === 'done'}
            onchange={(e) => {
              const task = e.currentTarget.checked ? 'done' : 'pending';
              void act((tx) => updateItem(tx, item.id, { task }));
            }}
          />
          <button class="link-button" onclick={() => onopen(item)}>{label(item)}</button>
          <span class="meta">{item.kind === 'group' ? t('kindTabGroup') : t('kindTab')}</span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

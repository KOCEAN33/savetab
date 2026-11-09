<script lang="ts">
  import { emptyTrash, restoreFromTrash, type ItemRecord } from '@savetab/core';
  import { transact } from '@/lib/db';

  let { trashed, tabCount }: { trashed: ItemRecord[]; tabCount: (groupId: string) => number } = $props();

  function label(r: ItemRecord): string {
    if (r.kind === 'group') {
      const n = tabCount(r.id);
      return r.title || `${n} ${n === 1 ? 'tab' : 'tabs'}`;
    }
    return r.title || r.url || '';
  }

  function deleteAll() {
    if (confirm('Permanently delete everything in the trash?')) void transact((tx) => emptyTrash(tx));
  }
</script>

<section aria-label="Trash">
  {#if trashed.length === 0}
    <p class="meta">Trash is empty.</p>
  {:else}
    <p><button class="button button-danger" onclick={deleteAll}>Delete all trash</button></p>
    <ul class="tabs">
      {#each trashed as r (r.id)}
        <li class="tab">
          <span>{label(r)}</span>
          <span class="meta">{r.kind === 'group' ? 'Group' : 'Tab'}, deleted {new Date(r.trashedAt ?? 0).toLocaleString()}</span>
          <button class="link-button" onclick={() => transact((tx) => restoreFromTrash(tx, [r.id]))}>Move back</button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

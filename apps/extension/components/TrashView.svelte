<script lang="ts">
  import { emptyTrash, restoreFromTrash, type ItemRecord } from '@savetab/core';
  import { transact } from '@/lib/db';
  import { t, tn } from '@/lib/i18n';

  let {
    trashed,
    tabCount,
    tabTitle,
  }: { trashed: ItemRecord[]; tabCount: (groupId: string) => number; tabTitle: (r: ItemRecord) => string } = $props();

  const KIND_LABEL: Record<string, string> = { folder: t('kindFolder'), group: t('kindGroup'), tab: t('kindTab') };

  function label(r: ItemRecord): string {
    if (r.kind === 'group') {
      const n = tabCount(r.id);
      return r.title || tn('tabCount', n);
    }
    if (r.kind === 'folder') return r.title || t('untitledFolder');
    return tabTitle(r) || r.url || '';
  }

  function deleteAll() {
    if (confirm(t('confirmEmptyTrash'))) void transact((tx) => emptyTrash(tx));
  }
</script>

<section aria-label={t('trash')}>
  {#if trashed.length === 0}
    <p class="meta">{t('trashEmpty')}</p>
  {:else}
    <p><button class="button button-danger" onclick={deleteAll}>{t('deleteAllTrash')}</button></p>
    <ul class="tabs">
      {#each trashed as r (r.id)}
        <li class="tab">
          <span>{label(r)}</span>
          <span class="meta">{t('trashedAt', { kind: KIND_LABEL[r.kind ?? 'tab']!, date: new Date(r.trashedAt ?? 0).toLocaleString() })}</span>
          <button class="link-button" onclick={() => transact((tx) => restoreFromTrash(tx, [r.id]))}>{t('moveBack')}</button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

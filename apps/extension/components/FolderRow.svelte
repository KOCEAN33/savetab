<script lang="ts">
  import type { Folder, ListView } from '@savetab/core';
  import { t, tn } from '@/lib/i18n';

  let { folder, view, onopen }: { folder: Folder; view: ListView; onopen: () => void } = $props();

  const label = $derived(folder.title || t('untitledFolder'));
</script>

<!-- A folder among search results. Opening it clears the search. -->
<p class="folder-result">
  <button class="chip" aria-label={t('folderLabel', { name: label })} onclick={onopen}>{label}</button>
  <span class="meta">{tn('folderTabs', view.tabCount(folder.id))}</span>
</p>

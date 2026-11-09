<script lang="ts">
  import type { Id, ListView, SearchQuery } from '@savetab/core';

  let { query = $bindable(), view, count }: { query: SearchQuery; view: ListView; count: number | null } = $props();

  let showFilters = $state(false);

  /** Every folder with its path, for the "restrict to a folder" filter. */
  const folders = $derived.by(() => {
    const out: { id: Id; path: string }[] = [];
    const walk = (parentId: Id | null, prefix: string) => {
      for (const item of view.children(parentId)) {
        if (item.kind !== 'folder') continue;
        const path = `${prefix}${item.title || 'Untitled folder'}`;
        out.push({ id: item.id, path });
        walk(item.id, `${path} / `);
      }
    };
    walk(null, '');
    return out;
  });

  const day = (ms: number | null) => (ms === null ? '' : new Date(ms).toLocaleDateString('sv'));
  /** Local midnight, or the last ms of the day for an upper bound. */
  function toMs(value: string, endOfDay: boolean): number | null {
    if (!value) return null;
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y!, m! - 1, d! + (endOfDay ? 1 : 0)).getTime() - (endOfDay ? 1 : 0);
  }
</script>

<div class="search">
  <div class="row">
    <input class="search-input" type="search" aria-label="Search" placeholder="Search" bind:value={query.text} />
    {#if count !== null}<span class="meta" role="status">{count} {count === 1 ? 'match' : 'matches'}</span>{/if}
    <button class="link-button" aria-expanded={showFilters} onclick={() => (showFilters = !showFilters)}>Filters</button>
  </div>
  {#if showFilters}
    <div class="search-filters">
      <label><input type="checkbox" bind:checked={query.caseSensitive} /> Case sensitive</label>
      <label><input type="checkbox" bind:checked={query.wholeWords} /> Whole words</label>
      <label><input type="checkbox" bind:checked={query.starred} /> Starred</label>
      <label><input type="checkbox" bind:checked={query.tasks} /> Tasks</label>
      <label><input type="checkbox" bind:checked={query.hasNotes} /> Has notes</label>
      <label><input type="checkbox" bind:checked={query.namedOnly} /> Named only</label>
      <label>
        Archived
        <select bind:value={query.archived}>
          <option value="any">archived and not</option>
          <option value="only">archived only</option>
          <option value="none">not archived</option>
        </select>
      </label>
      <label>
        Created on or after
        <input type="date" value={day(query.createdFrom)} onchange={(e) => (query.createdFrom = toMs(e.currentTarget.value, false))} />
      </label>
      <label>
        Created on or before
        <input type="date" value={day(query.createdTo)} onchange={(e) => (query.createdTo = toMs(e.currentTarget.value, true))} />
      </label>
      <label>
        In folder
        <select bind:value={query.folderId}>
          <option value={null}>everywhere</option>
          {#each folders as f (f.id)}<option value={f.id}>{f.path}</option>{/each}
        </select>
      </label>
    </div>
  {/if}
</div>

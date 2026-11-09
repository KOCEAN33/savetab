import { formatLinks, type Item, type ListView, type Tab } from '@savetab/core';

function tabsOf(view: ListView, item: Item): Tab[] {
  if (item.kind === 'tab') return [item];
  if (item.kind === 'group') return view.tabs(item.id);
  return view.groups(item.id).flatMap((g) => view.tabs(g.id));
}

/** Copy the item's links in the user's clipboard format. Returns the number of links copied. */
export async function copyLinks(view: ListView, items: Item[]): Promise<number> {
  const tabs = items.flatMap((i) => tabsOf(view, i));
  const out = formatLinks(
    tabs.map((t) => ({ url: t.url, title: view.title(t) })),
    view.settings.copyFormat,
  );
  if (out.html === undefined) {
    await navigator.clipboard.writeText(out.text);
  } else {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([out.text], { type: 'text/plain' }),
        'text/html': new Blob([out.html], { type: 'text/html' }),
      }),
    ]);
  }
  return tabs.length;
}

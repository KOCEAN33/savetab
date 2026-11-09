import { exportHtml, type Item, type ListView } from '@savetab/core';
import { tn } from './i18n';

/** Download a folder or group as one HTML file, named after its title. No `downloads` permission needed. */
export function saveHtml(view: ListView, item: Item): void {
  const html = exportHtml(view, item.id, (n) => tn('tabCount', n));
  const name = (item.title || 'savetab').replace(/[\\/:*?"<>|]+/g, '_').trim();
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.html`;
  a.click();
  // Revoked after the click's task, so the download has read the URL.
  setTimeout(() => URL.revokeObjectURL(url));
}

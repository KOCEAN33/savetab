import { randomKey, sealShare, setShare, shareContent, type Item, type ListView, type Share } from '@savetab/core';
import { syncAccount, transact, type SyncAccount } from './db';
import { tn } from './i18n';
import { client, SyncError, toBase64 } from './sync';

/** The item's shared web page, while the server still serves it. */
export function activeShare(item: Item, now = Date.now()): Share | undefined {
  if (item.kind === 'tab' || !item.share || item.share.expiresAt <= now) return undefined;
  return item.share;
}

/** The URL of a shared page. The key rides in the fragment, which no request carries. */
export function shareLink(serverUrl: string, share: Share): string {
  return `${serverUrl}/s/${share.id}#${share.key}`;
}

async function account(): Promise<SyncAccount> {
  const found = await syncAccount();
  if (!found) throw new Error('This device has no sync account');
  return found;
}

/**
 * Share a folder or group as a web page: upload a copy sealed under a key of its own, record the
 * share on the item, and return the page's URL.
 */
export async function shareItem(view: ListView, item: Item): Promise<string> {
  const acct = await account();
  const content = shareContent(view, item.id, (n) => tn('tabCount', n));
  if (!content) throw new Error('The item no longer exists');
  const key = randomKey();
  const data = toBase64(await sealShare(key, content));
  const made = await client(acct)<{ id: string; expiresAt: number }>('/v1/shares', {
    method: 'POST',
    body: JSON.stringify({ data }),
  });
  const keyText = toBase64(key).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const share: Share = { id: made.id, key: keyText, expiresAt: made.expiresAt };
  await transact((tx) => setShare(tx, item.id, share));
  return shareLink(acct.serverUrl, share);
}

/** Take the item's shared page down. A share the server no longer has counts as taken down. */
export async function stopSharing(item: Item): Promise<void> {
  if (item.kind === 'tab' || !item.share) return;
  try {
    await client(await account())(`/v1/shares/${item.share.id}`, { method: 'DELETE' });
  } catch (err) {
    if (!(err instanceof SyncError && err.status === 404)) throw err;
  }
  await transact((tx) => setShare(tx, item.id, null));
}

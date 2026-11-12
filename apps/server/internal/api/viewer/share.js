// The share viewer. The page answers the same for every share: the id comes from the path and
// the key from the URL fragment, which the browser never sends to the server. Every text from
// the share goes through textContent, so a title cannot inject markup.
'use strict';

const AAD = new TextEncoder().encode('savetab-share-v1');
const NOT_FOUND = 'This shared page does not exist or has expired.';
const NO_KEY = 'This link is missing its key.';
const UNREADABLE = 'This shared page could not be opened.';

class ShareError extends Error {}

main();

async function main() {
  const root = document.getElementById('share');
  try {
    const share = await load();
    render(root, share);
  } catch (err) {
    const message = document.createElement('p');
    message.className = 'message';
    message.textContent = err instanceof ShareError ? err.message : UNREADABLE;
    root.replaceChildren(message);
  }
}

async function load() {
  const id = location.pathname.split('/').pop();
  const fragment = location.hash.slice(1);
  if (!fragment) throw new ShareError(NO_KEY);
  const res = await fetch('../v1/shares/' + encodeURIComponent(id));
  if (res.status === 404) throw new ShareError(NOT_FOUND);
  if (!res.ok) throw new ShareError(UNREADABLE);
  const { data } = await res.json();
  const blob = decodeBase64(data);
  const raw = decodeBase64(fragment.replace(/-/g, '+').replace(/_/g, '/'));
  if (raw.length !== 32 || blob.length < 1 + 12 + 16 || blob[0] !== 1) {
    throw new ShareError(UNREADABLE);
  }
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: blob.subarray(1, 13), additionalData: AAD },
    key,
    blob.subarray(13),
  );
  const share = JSON.parse(new TextDecoder().decode(plain));
  if (share?.v !== 1 || !Array.isArray(share.items)) throw new ShareError(UNREADABLE);
  return share;
}

// decodeBase64 reads standard base64 with or without padding. Anything else throws.
function decodeBase64(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) {
    throw new ShareError(UNREADABLE);
  }
  return Uint8Array.from(atob(text.padEnd(Math.ceil(text.length / 4) * 4, '=')), (c) =>
    c.charCodeAt(0),
  );
}

function render(root, share) {
  const title = text(share.title);
  document.title = title || document.title;
  const parts = [element('h1', title), ...notes(share.notes)];
  const items = share.items;
  // A shared group arrives as a root holding that one group: show its title once.
  if (items.length === 1 && items[0]?.kind === 'group' && text(items[0].title) === title) {
    parts.push(group(items[0], false, text(share.notes)));
  } else {
    parts.push(...items.flatMap(node));
  }
  root.replaceChildren(...parts);
}

function node(item) {
  if (item?.kind === 'group') return [group(item, true, '')];
  if (item?.kind === 'folder') return [folder(item)];
  return [];
}

function folder(item) {
  const section = element('section', '', 'folder');
  const children = Array.isArray(item.items) ? item.items : [];
  section.append(element('h2', text(item.title)), ...notes(item.notes), ...children.flatMap(node));
  return section;
}

// group skips its notes when the heading above already showed the same text.
function group(item, withTitle, shownNotes) {
  const section = element('section', '', 'group');
  if (withTitle) section.append(element('h2', text(item.title)));
  if (text(item.notes) !== shownNotes) section.append(...notes(item.notes));
  const list = document.createElement('ul');
  for (const tab of Array.isArray(item.tabs) ? item.tabs : []) list.append(row(tab));
  section.append(list);
  return section;
}

function row(tab) {
  const url = text(tab?.url);
  const li = document.createElement('li');
  const link = element('a', text(tab?.title) || url, 'link');
  if (isWebUrl(url)) {
    link.href = url;
    link.rel = 'noopener noreferrer';
  }
  li.append(link, ...notes(tab?.notes));
  return li;
}

function notes(value) {
  const content = text(value);
  return content ? [element('p', content, 'notes')] : [];
}

function isWebUrl(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function element(tag, content, className) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (content) el.textContent = content;
  return el;
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

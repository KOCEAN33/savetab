import { emptyQuery, search, type ListView } from '@savetab/core';

const SUGGESTION_MAX = 6;

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/**
 * Suggestions for the `11` omnibox keyword. Chrome parses descriptions as XML and styles
 * `<url>`; Firefox shows them as plain text, so only Chrome gets markup.
 */
export function omniboxSuggestions(
  view: ListView,
  text: string,
  xml: boolean,
): { content: string; description: string }[] {
  const tabs = search(view, { ...emptyQuery, text })
    .groups.flatMap((r) => r.tabs)
    .slice(0, SUGGESTION_MAX);
  return tabs.map((t) => {
    const title = view.title(t) || t.url;
    return {
      content: t.url,
      description: xml ? `${escapeXml(title)} - <url>${escapeXml(t.url)}</url>` : `${title} - ${t.url}`,
    };
  });
}

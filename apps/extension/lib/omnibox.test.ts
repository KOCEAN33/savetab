import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { defaultSettings, ListView, storeTabs } from '@savetab/core';
import { db, transact } from './db';
import { omniboxSuggestions } from './omnibox';

describe('omniboxSuggestions', () => {
  it('suggests up to 6 matching tabs, opening each URL, with XML-escaped text where asked', async () => {
    const tabs = Array.from({ length: 8 }, (_, i) => ({
      url: `https://t${i}.example/`,
      title: `Tom & Jerry <${i}>`,
      favIconUrl: '',
    }));
    await transact((tx) =>
      storeTabs(tx, [...tabs, { url: 'https://other.example/', title: 'Other', favIconUrl: '' }], {
        ...defaultSettings,
        id: 'settings',
      }),
    );
    const view = new ListView(await db.items.toArray());

    const xml = omniboxSuggestions(view, 'jerry', true);
    expect(xml).toHaveLength(6);
    expect(xml[0]).toEqual({
      content: 'https://t0.example/',
      description: 'Tom &amp; Jerry &lt;0&gt; - <url>https://t0.example/</url>',
    });

    const plain = omniboxSuggestions(view, 'other', false);
    expect(plain).toEqual([{ content: 'https://other.example/', description: 'Other - https://other.example/' }]);
  });
});

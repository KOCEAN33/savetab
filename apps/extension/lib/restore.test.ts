import { describe, expect, it } from 'vitest';
import { defaultSettings, type Settings } from '@savetab/core';
import { restoreWindow } from './restore';

const s = (restoreGroupTarget: Settings['restoreGroupTarget']): Settings => ({
  ...defaultSettings,
  id: 'settings',
  restoreGroupTarget,
});

describe('restoreWindow', () => {
  it('follows restoreGroupTarget while the group restoreTarget is default', () => {
    expect(restoreWindow('default', s('new'), true, false)).toBe('new');
    expect(restoreWindow('default', s('current'), false, false)).toBe('current');
    expect(restoreWindow('default', s('newUnlessAlone'), true, false)).toBe('current');
    expect(restoreWindow('default', s('newUnlessAlone'), false, false)).toBe('new');
  });

  it("uses the group's own restoreTarget over restoreGroupTarget", () => {
    expect(restoreWindow('current', s('new'), false, false)).toBe('current');
    expect(restoreWindow('new', s('current'), true, false)).toBe('new');
    expect(restoreWindow('incognito', s('current'), true, false)).toBe('incognito');
  });

  it('follows tabGroupRestore instead for a group that opens as a browser tab group', () => {
    const tg = (tabGroupRestore: Settings['tabGroupRestore']) => ({ ...s('new'), tabGroupRestore });
    expect(restoreWindow('default', tg('current'), false, false, true)).toBe('current');
    expect(restoreWindow('default', { ...tg('new'), restoreGroupTarget: 'current' }, true, false, true)).toBe('new');
    expect(restoreWindow('current', tg('new'), false, false, true)).toBe('current');
  });

  it('opens a new window on Shift, except for an incognito group', () => {
    expect(restoreWindow('default', s('current'), true, true)).toBe('new');
    expect(restoreWindow('current', s('current'), true, true)).toBe('new');
    expect(restoreWindow('incognito', s('current'), true, true)).toBe('incognito');
  });
});

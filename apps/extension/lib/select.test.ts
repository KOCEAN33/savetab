import { describe, expect, it } from 'vitest';
import { selectTabs, type TabLike } from './select';

const tab = (id: number, extra: Partial<TabLike> = {}): TabLike => ({
  id,
  index: id,
  windowId: 1,
  highlighted: false,
  active: false,
  groupId: -1,
  ...extra,
});

describe('selectTabs', () => {
  const win = [tab(0), tab(1), tab(2, { active: true, highlighted: true }), tab(3), tab(4)];
  const ids = (xs: TabLike[]) => xs.map((t) => t.id);

  it('sends the whole window when one tab is highlighted and it is not in a tab group', () => {
    expect(ids(selectTabs('sendWindow', win, win))).toEqual([0, 1, 2, 3, 4]);
  });

  it('sends only highlighted tabs when several are highlighted', () => {
    const w = win.map((t) => (t.id === 4 ? { ...t, highlighted: true } : t));
    expect(ids(selectTabs('sendWindow', w, w))).toEqual([2, 4]);
  });

  it('sends only the active browser tab group, unless the whole window is asked for', () => {
    const w = win.map((t) => (t.index >= 2 ? { ...t, groupId: 7 } : t));
    expect(ids(selectTabs('sendWindow', w, w))).toEqual([2, 3, 4]);
    expect(ids(selectTabs('sendWholeWindow', w, w))).toEqual([0, 1, 2, 3, 4]);
  });

  it('splits around the active tab for left, right, and except-this', () => {
    expect(ids(selectTabs('left', win, win))).toEqual([0, 1]);
    expect(ids(selectTabs('right', win, win))).toEqual([3, 4]);
    expect(ids(selectTabs('exceptCurrent', win, win))).toEqual([0, 1, 3, 4]);
    expect(ids(selectTabs('current', win, win))).toEqual([2]);
  });

  it('sends every tab of every window for allWindows', () => {
    const other = [tab(10, { windowId: 2, index: 0 })];
    expect(ids(selectTabs('allWindows', win, [...win, ...other]))).toEqual([0, 1, 2, 3, 4, 10]);
  });
});

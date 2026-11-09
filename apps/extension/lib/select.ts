export type SendAction =
  | 'sendWindow'
  | 'sendWholeWindow'
  | 'current'
  | 'exceptCurrent'
  | 'left'
  | 'right'
  | 'allWindows'
  | 'tabGroup'
  | 'selected';

export interface TabLike {
  id?: number;
  index: number;
  windowId?: number;
  highlighted: boolean;
  active: boolean;
  groupId?: number;
}

const NO_GROUP = -1;

/** Which open tabs an action sends, given the current window's tabs and every window's tabs. */
export function selectTabs<T extends TabLike>(action: SendAction, windowTabs: T[], allTabs: T[]): T[] {
  const active = windowTabs.find((t) => t.active);
  const inActiveGroup = (t: T) => active?.groupId !== undefined && t.groupId === active.groupId;
  const activeGrouped = active?.groupId !== undefined && active.groupId !== NO_GROUP;
  switch (action) {
    case 'sendWindow': {
      const highlighted = windowTabs.filter((t) => t.highlighted);
      if (highlighted.length > 1) return highlighted;
      return activeGrouped ? windowTabs.filter(inActiveGroup) : windowTabs;
    }
    case 'sendWholeWindow':
      return windowTabs;
    case 'current':
      return active ? [active] : [];
    case 'exceptCurrent':
      return windowTabs.filter((t) => t !== active);
    case 'left':
      return active ? windowTabs.filter((t) => t.index < active.index) : [];
    case 'right':
      return active ? windowTabs.filter((t) => t.index > active.index) : [];
    case 'allWindows':
      return allTabs;
    case 'tabGroup':
      return activeGrouped ? windowTabs.filter(inActiveGroup) : [];
    case 'selected':
      return windowTabs.filter((t) => t.highlighted);
  }
}

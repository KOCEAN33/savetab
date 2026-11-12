export type Id = string;
/** Hybrid logical clock. Lexical order equals causal order, see hlc.ts. */
export type Hlc = string;

export type Kind = 'folder' | 'group' | 'tab' | 'link' | 'settings';

export interface CommonFields {
  kind: Kind;
  /** null = root of the list. */
  parentId: Id | null;
  /** Fractional index key, ordered among siblings. */
  order: string;
  createdAt: number;
  modifiedAt: number;
  accessedAt: number | null;
  /** Non-null = in trash. */
  trashedAt: number | null;
  /** Tombstone left after trash is emptied. Content fields are blanked. */
  purged: boolean;
  /** Empty = default label. */
  title: string;
  notes: string;
  star: boolean;
  collapsed: boolean;
}

export interface FolderFields extends CommonFields {
  kind: 'folder';
  pinnedTop: boolean;
}

/** Chrome's tab group colors. */
export type TabGroupColor = 'grey' | 'blue' | 'red' | 'yellow' | 'green' | 'pink' | 'purple' | 'cyan' | 'orange';

export interface OpenAs {
  mode: 'window' | 'tabGroup';
  color: TabGroupColor;
  collapsed: boolean;
}

export type RestoreTarget = 'default' | 'current' | 'new' | 'incognito';

export interface GroupFields extends CommonFields {
  kind: 'group';
  pinnedTop: boolean;
  locked: boolean;
  openAs: OpenAs;
  /** A restore choice from the group's menu. 'default' follows the restoreGroupTarget setting. */
  restoreTarget: RestoreTarget;
}

/** Groups stored before these fields existed read as these values. */
export const groupDefaults: Pick<GroupFields, 'openAs' | 'restoreTarget'> = {
  openAs: { mode: 'window', color: 'grey', collapsed: false },
  restoreTarget: 'default',
};

export interface TabFields extends CommonFields {
  kind: 'tab';
  url: string;
  favIconUrl: string;
  pinOnOpen: boolean;
}

/** Title and notes shared by every tab whose URL normalizes to `url`. */
export interface LinkFields {
  kind: 'link';
  url: string;
  title: string;
  notes: string;
  /** Tombstone left once no tab has the URL. Content fields are blanked. */
  purged: boolean;
}

export type CopyFormat = 'rich' | 'urlTitle' | 'titleUrl' | 'url' | 'markdown';

export interface SettingsFields {
  kind: 'settings';
  excludedDomains: string[];
  duplicates: 'allow' | 'reject';
  titleOnDuplicate: 'keep' | 'update';
  pinnedTabs: 'skip' | 'allow';
  afterRestore: 'remove' | 'keep';
  restoreGroupTarget: 'current' | 'newUnlessAlone' | 'new';
  switchToRestored: boolean;
  groupTitleClick: 'edit' | 'restore';
  urlDisplay: 'full' | 'abbreviated' | 'domain' | 'none';
  copyFormat: CopyFormat;
  tabGroupRestore: 'current' | 'new';
  discardOnOpen: boolean;
}

export type Folder = { id: Id } & FolderFields;
export type Group = { id: Id } & GroupFields;
export type Tab = { id: Id } & TabFields;
export type Link = { id: Id } & LinkFields;
export type Settings = { id: Id } & SettingsFields;
export type Item = Folder | Group | Tab;

type FieldsOf<K extends Kind> = K extends 'folder'
  ? FolderFields
  : K extends 'group'
    ? GroupFields
    : K extends 'tab'
      ? TabFields
      : K extends 'link'
        ? LinkFields
        : SettingsFields;

/**
 * Stored form of any record. Fields arrive one op at a time from other devices,
 * so a record may lack fields until its creating op is applied.
 */
export type ItemRecord = { id: Id; clocks: Record<string, Hlc>; kind?: Kind } & Partial<
  Omit<CommonFields, 'kind'> & Omit<GroupFields, 'kind'> & Omit<TabFields, 'kind'> & Omit<SettingsFields, 'kind'>
> &
  Record<string, unknown>;

export interface Op {
  opId: Id;
  itemId: Id;
  hlc: Hlc;
  fields: Record<string, unknown>;
}

export const SETTINGS_ID = 'settings';

export const defaultSettings: SettingsFields = {
  kind: 'settings',
  excludedDomains: [],
  duplicates: 'allow',
  titleOnDuplicate: 'keep',
  pinnedTabs: 'skip',
  afterRestore: 'remove',
  restoreGroupTarget: 'newUnlessAlone',
  switchToRestored: false,
  groupTitleClick: 'edit',
  urlDisplay: 'domain',
  copyFormat: 'rich',
  tabGroupRestore: 'current',
  discardOnOpen: false,
};

/** Character limit of a notes field. */
export const NOTES_MAX = 5000;

export function isKind<K extends Kind>(
  rec: ItemRecord | undefined,
  kind: K,
): rec is ItemRecord & { id: Id } & FieldsOf<K> {
  return rec?.kind === kind;
}

/** A visible item: created, not trashed, not purged. */
export function isLive(rec: ItemRecord | undefined): boolean {
  return rec?.kind !== undefined && rec.trashedAt == null && rec.purged !== true;
}

export function readSettings(rec: ItemRecord | undefined): Settings {
  const s: Settings = { ...defaultSettings, ...(rec as Partial<SettingsFields> | undefined), id: SETTINGS_ID };
  // Older records may hold an afterRestore value no longer offered, such as 'archive'. It kept tabs listed.
  return s.afterRestore === 'remove' ? s : { ...s, afterRestore: 'keep' };
}

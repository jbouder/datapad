import { LIMITS } from './limits';
import { LIST_SORTS } from './lists';
import { PROJECT_SORTS } from './projects';
import type { PagePrefsPatch } from './protocol';
import {
  ATTENTION_QUIET_CHOICES,
  ATTENTION_TARGET_CHOICES,
  FOCUS_DAY_CHOICES,
  FOCUS_DAYS,
  FOCUS_DEFAULTS,
  FOLLOW_UP_CHOICES,
  type FocusOptions,
  meId,
  orgs,
} from './select';
import { TASK_SORTS } from './tasks';
import {
  GENERAL,
  PAGE_KEYS,
  type PageKey,
  type PagePrefs,
  type Snapshot,
  settingsOf,
} from './types';

/**
 * Saved page preferences (#186), the pure half: which settings each page
 * remembers, how a page's address and its saved settings combine (the URL
 * wins, then what is saved, then the page's defaults), what a change saves,
 * which sections a page shows and in what order (#310), and the one-time
 * carry-over from the per-browser keys used before.
 * `src/providers/PagePrefsProvider.tsx` holds the debounced saving and the
 * hooks pages read them with (`usePageQuery`, `usePageSections`,
 * `usePageSetting`).
 */

export interface PrefOption {
  value: string;
  label: string;
}

/**
 * A list that comes from the data rather than the page: `me` is Anyone,
 * and Mine when a person is marked as me (Focus's Tasks for, #311).
 */
export type PrefKind = 'who' | 'me' | 'project' | 'org';

export interface PrefField {
  /**
   * Its query key. `view`, `sort`, `dir` and `group` are `PagePrefs`
   * fields of their own; any other key is a filter.
   */
  key: string;
  label: string;
  /** What the page shows with nothing chosen (`''` for "any"). */
  def: string;
  /**
   * The default spelled out in the address when `def` is empty (an empty
   * parameter is no parameter): it reads as the default because no
   * project, org or health has that value.
   */
  token?: string;
  /** The values the page has; absent for a `kind` list. */
  options?: readonly PrefOption[];
  /**
   * Values an older release had, and the value each now reads as (Notes'
   * `feed` is `list` since #218), saved or in the address.
   */
  renamed?: Readonly<Record<string, string>>;
  kind?: PrefKind;
  /** The control the page uses for it, which Settings → Pages reuses. */
  control: 'segmented' | 'select';
  /**
   * Set in Settings → Pages only, never in the address (#310): a threshold
   * or a display choice with no business in a link. Saved under `filters`
   * like any other key and read with `currentValues()` (or the
   * `usePageSetting()` hook); `effectiveQuery()` and `planChange()` leave
   * the address alone for it, and it is not a filter (`filterFields()`).
   */
  settingsOnly?: true;
}

/** A section a page can hide and move (#310), and its name in Settings. */
export interface PageSection {
  key: string;
  label: string;
}

export interface PageSpec {
  label: string;
  /**
   * The layout first, when the page has one, then the page's other
   * remembered controls.
   */
  fields: readonly PrefField[];
  /** Whether the page has sections that remember open or closed. */
  sections: boolean;
  /**
   * The keys of those sections, when the page names them: a saved key
   * that is not one (a section an older release had) is ignored when
   * Settings → Pages counts them.
   */
  collapsible?: readonly string[];
  /**
   * The sections the page can hide and put in another order (#310), in
   * their default order, each with its label for Settings → Pages. Set
   * once the page renders them through `usePageSections()`; a saved key
   * that is not one is ignored.
   */
  sectionKeys?: readonly PageSection[];
}

/**
 * Focus's collapsible sections (#206): Since yesterday (#258), Waiting
 * on, Attention and Follow-ups. The buckets that used to be sections (Blocked, This week,
 * Later, No date, and Day's `day:` copies) are gone.
 */
export const FOCUS_SECTIONS = [
  'recap',
  'waiting',
  'attention',
  'followUps',
] as const;

const PROJECT_LAYOUTS = [
  { value: 'cards', label: 'Cards' },
  { value: 'table', label: 'Table' },
  { value: 'timeline', label: 'Timeline' },
];

function layout(
  options: readonly PrefOption[],
  def: string,
  label = 'Layout',
  renamed?: Readonly<Record<string, string>>,
): PrefField {
  return {
    key: 'view',
    label,
    def,
    options,
    control: 'segmented',
    ...(renamed ? { renamed } : {}),
  };
}

/** A value as the page reads it now: an old name becomes the new one. */
export function currentName(field: PrefField, value: string): string {
  return field.renamed && Object.hasOwn(field.renamed, value)
    ? (field.renamed[value] ?? value)
    : value;
}

/** How far Focus's Week looks ahead: set in Settings → Pages only. */
const focusDaysField: PrefField = {
  key: 'days',
  label: 'Week shows',
  def: String(FOCUS_DAYS),
  options: FOCUS_DAY_CHOICES.map((n) => ({
    value: String(n),
    label: `${n} days`,
  })),
  control: 'select',
};

/** Focus's Week window from a page query or saved values (`?days=`). */
export function focusDays(value: string | null | undefined): number {
  return choice(value, FOCUS_DAY_CHOICES, FOCUS_DAYS);
}

/** `value` as one of `choices`, else `def`. */
function choice(
  value: string | null | undefined,
  choices: readonly number[],
  def: number,
): number {
  const n = Number(value);
  return value && choices.includes(n) ? n : def;
}

const dayOptions = (choices: readonly number[]): PrefOption[] =>
  choices.map((n) => ({ value: String(n), label: `${n} days` }));

/**
 * Focus's other settings (#311): whose tasks it shows and how Due is
 * grouped (both in the address, `?who=` and `?group=`), and the rules
 * behind Attention and Follow-ups (Settings → Pages only).
 */
const focusFields: readonly PrefField[] = [
  {
    key: 'who',
    label: 'Tasks for',
    def: 'anyone',
    kind: 'me',
    control: 'select',
  },
  {
    key: 'group',
    label: 'Group Due by',
    def: 'priority',
    options: [
      { value: 'priority', label: 'Priority' },
      { value: 'date', label: 'Date' },
    ],
    control: 'segmented',
  },
  {
    key: 'target',
    label: 'Attention: target within',
    def: String(FOCUS_DEFAULTS.targetDays),
    options: dayOptions(ATTENTION_TARGET_CHOICES),
    control: 'select',
    settingsOnly: true,
  },
  {
    key: 'quiet',
    label: 'Attention: quiet after',
    def: String(FOCUS_DEFAULTS.quietDays),
    options: [
      ...dayOptions(ATTENTION_QUIET_CHOICES),
      { value: 'off', label: 'Off' },
    ],
    control: 'select',
    settingsOnly: true,
  },
  {
    key: 'yellow',
    label: 'Attention: yellow health',
    def: 'include',
    options: [
      { value: 'include', label: 'Include' },
      { value: 'leave', label: 'Leave out' },
    ],
    control: 'segmented',
    settingsOnly: true,
  },
  {
    key: 'followDays',
    label: 'Follow-ups from the last',
    def: String(FOCUS_DEFAULTS.followUpDays),
    options: dayOptions(FOLLOW_UP_CHOICES),
    control: 'segmented',
    settingsOnly: true,
  },
];

/**
 * Focus's settings (#311) from values by query key: the page's address
 * over what it saved (`?who=`, `?group=`, `?days=`) and its settings-only
 * values, or just what is saved (`savedFocusOptions`). A value Focus does
 * not have reads as the default; Mine reads as Anyone when nobody in
 * `people` is marked as me. One copy of the rules: the page, Brief me and
 * MCP all read them here.
 */
export function focusOptions(
  values: Readonly<Record<string, string | null | undefined>>,
  people: Snapshot['people'],
): FocusOptions {
  const d = FOCUS_DEFAULTS;
  return {
    who:
      values.who === 'mine' && meId(people) !== null ? { kind: 'mine' } : d.who,
    group: values.group === 'date' ? 'date' : d.group,
    days: focusDays(values.days),
    targetDays: choice(values.target, ATTENTION_TARGET_CHOICES, d.targetDays),
    quietDays:
      values.quiet === 'off'
        ? null
        : choice(values.quiet, ATTENTION_QUIET_CHOICES, d.quietDays ?? 0),
    yellow: values.yellow !== 'leave',
    followUpDays: choice(values.followDays, FOLLOW_UP_CHOICES, d.followUpDays),
  };
}

/** Focus's settings as saved for the space (MCP's `get_focus`, `get_recap`). */
export function savedFocusOptions(
  snapshot: Pick<Snapshot, 'settings' | 'people' | 'projects' | 'orgs'>,
): FocusOptions {
  return focusOptions(
    currentValues('focus', savedPrefs(snapshot, 'focus'), snapshot),
    snapshot.people,
  );
}

const who: PrefField = {
  key: 'who',
  label: 'Assignee',
  def: 'anyone',
  kind: 'who',
  control: 'select',
};

const project: PrefField = {
  key: 'project',
  label: 'Project',
  def: '',
  token: 'all',
  kind: 'project',
  control: 'select',
};

const PROJECT_SORT_LABELS: Record<(typeof PROJECT_SORTS)[number], string> = {
  updated: 'Recently updated',
  priority: 'Priority',
  name: 'Name',
  start: 'Start date',
  target: 'Target date',
  milestone: 'Next milestone',
};

const TASK_SORT_LABELS: Record<(typeof TASK_SORTS)[number], string> = {
  title: 'Title',
  project: 'Project',
  priority: 'Priority',
  due: 'Due',
  assignee: 'Assignee',
  updated: 'Updated',
};

/** Projects' Status filter. */
export const PROJECT_STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'done', label: 'Done' },
  { value: 'all', label: 'All' },
] as const;

/** Projects' Health filter; empty is any. */
export const HEALTH_OPTIONS = [
  { value: '', label: 'Any health' },
  { value: 'red', label: 'Red' },
  { value: 'yellow', label: 'Yellow' },
  { value: 'green', label: 'Green' },
] as const;

export const PROJECT_SORT_OPTIONS: readonly PrefOption[] = PROJECT_SORTS.map(
  (s) => ({ value: s, label: PROJECT_SORT_LABELS[s] }),
);

/** Projects' and Archived's Sort by. */
const projectSort: PrefField = {
  key: 'sort',
  label: 'Sort by',
  def: 'updated',
  options: PROJECT_SORT_OPTIONS,
  control: 'select',
};

/** Tasks' sorts, by the column each one is. */
export const TASK_SORT_OPTIONS: readonly PrefOption[] = TASK_SORTS.map((s) => ({
  value: s,
  label: TASK_SORT_LABELS[s],
}));

/** Tasks' Status filter. */
export const TASK_STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
  { value: 'all', label: 'All' },
] as const;

/** Tasks' Group by. */
export const TASK_GROUP_OPTIONS = [
  { value: 'project', label: 'Project' },
  { value: 'due', label: 'Due date' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'priority', label: 'Priority' },
  { value: 'none', label: 'Nothing' },
] as const;

const LIST_SORT_LABELS: Record<(typeof LIST_SORTS)[number], string> = {
  updated: 'Recently updated',
  created: 'Created',
  title: 'Title',
};

/** Lists' Sort by (#299). */
export const LIST_SORT_OPTIONS: readonly PrefOption[] = LIST_SORTS.map((s) => ({
  value: s,
  label: LIST_SORT_LABELS[s],
}));

/** Lists' Show filter: how far along. */
export const LIST_SHOW_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
] as const;

/**
 * The project page's sections (#312), in today's order: on desktop the
 * first three sit in the left column and the rest in the right, each
 * column in the saved order (`projectColumns`); on a phone, one column in
 * the saved order.
 */
export const PROJECT_PAGE_SECTIONS: readonly PageSection[] = [
  { key: 'milestones', label: 'Milestones' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'meetings', label: 'Meetings' },
  { key: 'notes', label: 'Notes' },
  { key: 'lists', label: 'Lists' },
  { key: 'whiteboard', label: 'Whiteboard' },
  { key: 'activity', label: 'Activity' },
];

/** The project page's sections that sit in its left column on desktop. */
const PROJECT_LEFT = new Set(['milestones', 'tasks', 'meetings']);

/**
 * The project page's two desktop columns (#312): `visible` (the sections
 * it shows, in the saved order) split by the column each one belongs to,
 * keeping that order within each.
 */
export function projectColumns(visible: readonly string[]): {
  left: string[];
  right: string[];
} {
  return {
    left: visible.filter((key) => PROJECT_LEFT.has(key)),
    right: visible.filter((key) => !PROJECT_LEFT.has(key)),
  };
}

/**
 * The project page's Show past (#320): past meetings after the upcoming
 * ones in Meetings' list. Set from the toggle in the Meetings header or in
 * Settings → Pages; never in the address. It replaced Meetings shows
 * (#312), whose saved `meetings` is ignored, so it reads as Hide.
 */
const projectPastField: PrefField = {
  key: 'past',
  label: 'Past meetings',
  def: 'hide',
  options: [
    { value: 'hide', label: 'Hide' },
    { value: 'show', label: 'Show' },
  ],
  control: 'segmented',
  settingsOnly: true,
};

/**
 * The project page's Show done (#318): done tasks after the open ones in
 * Tasks' list, and the board's Done column. Set from the toggle in the
 * Tasks header or in Settings → Pages; never in the address.
 */
const projectDoneField: PrefField = {
  key: 'done',
  label: 'Done tasks',
  def: 'hide',
  options: [
    { value: 'hide', label: 'Hide' },
    { value: 'show', label: 'Show' },
  ],
  control: 'segmented',
  settingsOnly: true,
};

/** How the task page shows the note a task was made from (#312). */
export const SOURCE_NOTE_OPTIONS = [
  { value: 'expanded', label: 'Expanded' },
  { value: 'collapsed', label: 'Collapsed' },
  { value: 'hidden', label: 'Hidden' },
] as const;

export type SourceNoteShow = (typeof SOURCE_NOTE_OPTIONS)[number]['value'];

const sourceNoteField: PrefField = {
  key: 'sourceNote',
  label: 'Source note',
  def: 'expanded',
  options: SOURCE_NOTE_OPTIONS,
  control: 'segmented',
  settingsOnly: true,
};

/** A saved Source note as the task page reads it; anything else is Expanded. */
export function sourceNoteShow(value: string): SourceNoteShow {
  return (
    SOURCE_NOTE_OPTIONS.find((o) => o.value === value)?.value ?? 'expanded'
  );
}

/**
 * The meeting page's sections (#313), in today's order: Topics and
 * Action items on the left, Notes on the right, the series links at the
 * foot.
 */
export const MEETING_SECTIONS: readonly PageSection[] = [
  { key: 'topics', label: 'Topics' },
  { key: 'actions', label: 'Action items' },
  { key: 'notes', label: 'Notes' },
  { key: 'series', label: 'Series' },
];

/** A Show · Hide choice set in Settings → Pages only (#313). */
function showHide(key: string, label: string): PrefField {
  return {
    key,
    label,
    def: 'show',
    options: [
      { value: 'show', label: 'Show' },
      { value: 'hide', label: 'Hide' },
    ],
    control: 'segmented',
    settingsOnly: true,
  };
}

/**
 * How the list page shows its done items (#313): under a collapsed
 * Done (n), as before; under it, open; or left out, with "n done" in
 * their place.
 */
export const LIST_DONE_OPTIONS = [
  { value: 'collapsed', label: 'Collapsed' },
  { value: 'expanded', label: 'Expanded' },
  { value: 'hidden', label: 'Hidden' },
] as const;

/** How the list page shows its done items. */
export type ListDoneMode = (typeof LIST_DONE_OPTIONS)[number]['value'];

/** A saved Done items value as a mode; anything else is the default. */
export function listDoneMode(value: string): ListDoneMode {
  return value === 'expanded' || value === 'hidden' ? value : 'collapsed';
}

/** What each page remembers, in the order Settings → Pages shows them. */
export const PAGES: Record<PageKey, PageSpec> = {
  focus: {
    label: 'Focus',
    fields: [
      layout(
        [
          { value: 'day', label: 'Day' },
          { value: 'week', label: 'Week' },
        ],
        'day',
      ),
      focusDaysField,
      ...focusFields,
    ],
    sections: true,
    collapsible: FOCUS_SECTIONS,
    sectionKeys: [
      { key: 'recap', label: 'Since yesterday' },
      { key: 'agenda', label: 'Agenda' },
      { key: 'waiting', label: 'Waiting on' },
      { key: 'attention', label: 'Attention' },
      { key: 'followUps', label: 'Follow-ups' },
      { key: 'due', label: 'Due' },
    ],
  },
  projects: {
    label: 'Projects',
    fields: [
      layout(PROJECT_LAYOUTS, 'cards'),
      {
        key: 'status',
        label: 'Status',
        def: 'active',
        options: PROJECT_STATUS_OPTIONS,
        control: 'segmented',
      },
      {
        key: 'health',
        label: 'Health',
        def: '',
        token: 'any',
        options: HEALTH_OPTIONS,
        control: 'select',
      },
      {
        key: 'org',
        label: 'Org',
        def: '',
        token: 'all',
        kind: 'org',
        control: 'select',
      },
      projectSort,
    ],
    sections: false,
  },
  archive: {
    label: 'Archived',
    fields: [layout(PROJECT_LAYOUTS, 'cards'), projectSort],
    sections: false,
  },
  tasks: {
    label: 'Tasks',
    fields: [
      // The table on desktop, the list on phones: the page passes it.
      layout(
        [
          { value: 'list', label: 'List' },
          { value: 'table', label: 'Table' },
          { value: 'board', label: 'Board' },
          { value: 'timeline', label: 'Timeline' },
        ],
        'table',
      ),
      {
        key: 'status',
        label: 'Status',
        def: 'open',
        options: TASK_STATUS_OPTIONS,
        control: 'segmented',
      },
      {
        key: 'group',
        label: 'Group by',
        def: 'project',
        options: TASK_GROUP_OPTIONS,
        control: 'select',
      },
      who,
      {
        key: 'sort',
        label: 'Sort by',
        def: 'due',
        options: TASK_SORT_OPTIONS,
        control: 'select',
      },
      {
        key: 'dir',
        label: 'Direction',
        def: 'asc',
        options: [
          { value: 'asc', label: 'Ascending' },
          { value: 'desc', label: 'Descending' },
        ],
        control: 'segmented',
      },
    ],
    sections: false,
  },
  meetings: {
    label: 'Meetings',
    fields: [
      layout(
        [
          { value: 'list', label: 'List' },
          { value: 'calendar', label: 'Calendar' },
          { value: 'timeline', label: 'Timeline' },
        ],
        'list',
      ),
      project,
    ],
    sections: false,
  },
  notes: {
    label: 'Notes',
    fields: [
      // Feed became List (#218); Notepad, a layout until it got a page of
      // its own (#261), reads as List.
      layout(
        [
          { value: 'list', label: 'List' },
          { value: 'grid', label: 'Grid' },
        ],
        'list',
        'Layout',
        { feed: 'list', notepad: 'list' },
      ),
      project,
      {
        key: 'pinned',
        label: 'Show',
        def: '',
        token: '0',
        options: [
          { value: '', label: 'All' },
          { value: '1', label: 'Pinned' },
        ],
        control: 'segmented',
      },
    ],
    sections: false,
  },
  lists: {
    label: 'Lists',
    fields: [
      layout(
        [
          { value: 'cards', label: 'Cards' },
          { value: 'table', label: 'Table' },
        ],
        'cards',
      ),
      project,
      {
        key: 'show',
        label: 'Show',
        def: 'all',
        options: LIST_SHOW_OPTIONS,
        control: 'segmented',
      },
      {
        key: 'sort',
        label: 'Sort by',
        def: 'updated',
        options: LIST_SORT_OPTIONS,
        control: 'select',
      },
    ],
    sections: false,
  },
  people: {
    label: 'People',
    fields: [
      layout(
        [
          { value: 'list', label: 'List' },
          { value: 'cards', label: 'Cards' },
        ],
        'list',
      ),
    ],
    sections: false,
  },
  project: {
    label: 'Project page',
    fields: [
      layout(
        [
          { value: 'list', label: 'List' },
          { value: 'board', label: 'Board' },
        ],
        'list',
        'Tasks layout',
      ),
      projectDoneField,
      projectPastField,
    ],
    sections: true,
    sectionKeys: PROJECT_PAGE_SECTIONS,
    // Only its own sections: the Done group inside Tasks is gone (#318),
    // and what it saved is ignored.
    collapsible: PROJECT_PAGE_SECTIONS.map((s) => s.key),
  },
  task: {
    label: 'Task page',
    fields: [sourceNoteField],
    sections: true,
    collapsible: ['notes'],
  },
  meeting: {
    label: 'Meeting page',
    fields: [
      showHide('covered', 'Covered topics'),
      showHide('doneActions', 'Done action items'),
    ],
    sections: false,
    sectionKeys: MEETING_SECTIONS,
  },
  list: {
    label: 'List page',
    fields: [
      {
        key: 'done',
        label: 'Done items',
        def: 'collapsed',
        options: LIST_DONE_OPTIONS,
        control: 'segmented',
        settingsOnly: true,
      },
    ],
    sections: false,
  },
};

/**
 * Whether a page has anything to set in Settings → Pages: a remembered
 * field, sections that remember open or closed, or sections to hide and
 * move.
 */
export function hasPageSettings(page: PageKey): boolean {
  const spec = PAGES[page];
  return (
    spec.fields.length > 0 ||
    spec.sections ||
    (spec.sectionKeys?.length ?? 0) > 0
  );
}

/** Defaults that depend on the device (Tasks' layout), by query key. */
export type PrefDefaults = Partial<Record<string, string>>;

export function pageField(page: PageKey, key: string): PrefField | undefined {
  return PAGES[page].fields.find((f) => f.key === key);
}

function defaultOf(field: PrefField, defaults?: PrefDefaults): string {
  return defaults?.[field.key] ?? field.def;
}

const OWN = ['view', 'sort', 'dir', 'group'] as const;
type Own = (typeof OWN)[number];
const isOwn = (key: string): key is Own =>
  (OWN as readonly string[]).includes(key);

/**
 * A page's filters (#269): the remembered fields that narrow what it
 * lists. The layout, sort, direction and grouping arrange the list rather
 * than narrow it, so they are not filters.
 */
export function filterFields(page: PageKey): PrefField[] {
  return PAGES[page].fields.filter((f) => !isOwn(f.key) && !f.settingsOnly);
}

/**
 * How many of a page's filters are away from their defaults, in its query
 * as the page reads it (`effectiveQuery`: the address over what is saved).
 * Find and the sort are not counted. A value the page does not have reads
 * as the default, as the page shows it.
 */
export function activeFilterCount(
  page: PageKey,
  query: URLSearchParams,
): number {
  let count = 0;
  for (const field of filterFields(page)) {
    const raw = query.get(field.key);
    if (raw === null || raw === '' || raw === field.token) continue;
    const value = currentName(field, raw);
    if (field.options && !field.options.some((o) => o.value === value)) {
      continue;
    }
    if (value !== field.def) count += 1;
  }
  return count;
}

/** The text in a list page's Find (`?q=`), never saved. */
export function findText(query: URLSearchParams): string {
  return query.get('q')?.trim() ?? '';
}

/**
 * Whether a list page shows less than everything it would by default: a
 * filter away from its default, or words in Find. The toolbar's Clear
 * filters and the "None match these filters." empty state both follow it.
 */
export function isFiltered(page: PageKey, query: URLSearchParams): boolean {
  return activeFilterCount(page, query) > 0 || findText(query) !== '';
}

/**
 * The change Clear filters makes: every filter back to its default and
 * Find emptied. The layout, sort and grouping stay as they are.
 */
export function clearFilters(page: PageKey): Record<string, null> {
  const out: Record<string, null> = { q: null };
  for (const field of filterFields(page)) out[field.key] = null;
  return out;
}

/** One page's saved preferences, as stored (empty when none). */
export function savedPrefs(
  snapshot: Pick<Snapshot, 'settings'>,
  page: PageKey,
): PagePrefs {
  return settingsOf(snapshot).pages?.[page] ?? {};
}

/** Whether the space has ever saved page preferences (`pages` present). */
export function hasPagePrefs(snapshot: Pick<Snapshot, 'settings'>): boolean {
  return settingsOf(snapshot).pages !== undefined;
}

/** The saved values by query key: `view`, `sort`, … and the filters. */
export function prefValues(prefs: PagePrefs): Record<string, string> {
  const out: Record<string, string> = { ...prefs.filters };
  for (const key of OWN) {
    const value = prefs[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** The choices for a field, from the page or from the data. */
export function optionsFor(
  field: PrefField,
  state: Pick<Snapshot, 'people' | 'projects' | 'orgs'>,
): PrefOption[] {
  if (field.options) return [...field.options];
  switch (field.kind) {
    case 'who': {
      const me = meId(state.people);
      return [
        { value: 'anyone', label: 'Anyone' },
        ...(me ? [{ value: 'mine', label: 'Mine' }] : []),
        { value: 'unassigned', label: 'Unassigned' },
        ...Object.values(state.people)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((p) => ({ value: `p:${p.id}`, label: p.name })),
      ];
    }
    case 'me':
      return [
        { value: 'anyone', label: 'Anyone' },
        ...(meId(state.people) ? [{ value: 'mine', label: 'Mine' }] : []),
      ];
    case 'project':
      return [
        { value: '', label: 'All projects' },
        { value: GENERAL, label: 'General' },
        ...Object.values(state.projects)
          .sort(
            (a, b) =>
              Number(a.archived) - Number(b.archived) ||
              a.name.localeCompare(b.name),
          )
          .map((p) => ({
            value: p.id,
            label: p.archived ? `${p.name} (archived)` : p.name,
          })),
      ];
    case 'org':
      return [
        { value: '', label: 'All orgs' },
        ...orgs(state.projects, state.orgs).map((o) => ({
          value: o,
          label: o,
        })),
      ];
    default:
      return [];
  }
}

/**
 * Whether the page still has `value` for `field`: a layout it still
 * offers, a person, project or org that still exists. Anything else is
 * ignored when read, so the page shows its default instead.
 */
export function isCurrent(
  field: PrefField,
  value: string,
  state: Pick<Snapshot, 'people' | 'projects' | 'orgs'>,
): boolean {
  if (field.options) return field.options.some((o) => o.value === value);
  switch (field.kind) {
    case 'who':
      return (
        value === 'anyone' ||
        value === 'mine' ||
        value === 'unassigned' ||
        (value.startsWith('p:') && Boolean(state.people[value.slice(2)]))
      );
    case 'me':
      return (
        value === 'anyone' || (value === 'mine' && meId(state.people) !== null)
      );
    case 'project':
      return value === GENERAL || Boolean(state.projects[value]);
    case 'org':
      return orgs(state.projects, state.orgs).includes(value);
    default:
      return false;
  }
}

/**
 * One page's saved values that still apply, by query key: a field the page
 * no longer remembers, or a value it no longer has, is left out.
 */
export function currentValues(
  page: PageKey,
  prefs: PagePrefs,
  state: Pick<Snapshot, 'people' | 'projects' | 'orgs'>,
): Record<string, string> {
  const saved = prefValues(prefs);
  const out: Record<string, string> = {};
  for (const field of PAGES[page].fields) {
    const raw = saved[field.key];
    const value = raw === undefined ? undefined : currentName(field, raw);
    if (value !== undefined && isCurrent(field, value, state)) {
      out[field.key] = value;
    }
  }
  return out;
}

/**
 * What a page reads: its address, with each remembered key the address
 * lacks taken from what is saved. The address wins key by key, so a link
 * or Back still shows what it named; a bare address shows the saved
 * settings without being rewritten. A default spelled out in the address
 * (`project=all`, see `PrefField.token`) comes out as no parameter, as the
 * page reads its default. The search text and ids of single
 * items are never saved, so they only ever come from the address.
 */
export function effectiveQuery(
  page: PageKey,
  url: URLSearchParams,
  saved: Record<string, string>,
): URLSearchParams {
  const out = new URLSearchParams(url);
  for (const field of PAGES[page].fields) {
    // Never read from the address (#310): the page reads what is saved.
    if (field.settingsOnly) {
      out.delete(field.key);
      continue;
    }
    const value = saved[field.key];
    if (value !== undefined && !out.has(field.key)) out.set(field.key, value);
    // An old name in the address (`view=feed`) reads as the new one.
    const asked = out.get(field.key);
    if (asked !== null && currentName(field, asked) !== asked) {
      out.set(field.key, currentName(field, asked));
    }
    // A default spelled out (`project=all`) reads as no filter.
    if (field.token && out.get(field.key) === field.token) {
      out.delete(field.key);
    }
  }
  return out;
}

/**
 * A change to a page's controls (`null` or `''` is the default, as pages
 * already write it): what to save, what the address becomes, and what to
 * pin on the entry being left.
 *
 * - `patch`: the new value, or `null` (cleared) when it is the default.
 * - `url`: the value, or no parameter for the default, as before #186;
 *   the page then reads its default or, with no parameter, what it saved,
 *   which is now the same.
 * - `pin`: what the page showed for each changed key (`shown`, else the
 *   default; an empty default as its token). Written onto the entry being
 *   left when it lacks the key, so Back returns to what was shown rather
 *   than to what was just saved.
 */
export function planChange(
  page: PageKey,
  changes: Record<string, string | null>,
  shown: Record<string, string>,
  defaults?: PrefDefaults,
): {
  url: Record<string, string | null>;
  pin: Record<string, string>;
  patch: PagePrefsPatch | null;
} {
  const url: Record<string, string | null> = {};
  const pin: Record<string, string> = {};
  const saved: Record<string, string | null> = {};
  for (const [key, raw] of Object.entries(changes)) {
    const field = pageField(page, key);
    if (!field) {
      url[key] = raw;
      continue;
    }
    const def = defaultOf(field, defaults);
    const value =
      raw === null || raw === '' || (field.token && raw === field.token)
        ? def
        : raw;
    saved[key] = value === def ? null : value;
    // Saved only: the address and Back never carry it (#310).
    if (field.settingsOnly) continue;
    url[key] = value === def ? null : value;
    const before = shown[key] ?? def;
    const spelled = before === '' ? field.token : before;
    if (spelled) pin[key] = spelled;
  }
  return {
    url,
    pin,
    patch: Object.keys(saved).length > 0 ? patchOf(saved) : null,
  };
}

/** Values by query key (`null` clears) as a `setPagePrefs` patch. */
export function patchOf(values: Record<string, string | null>): PagePrefsPatch {
  const patch: PagePrefsPatch = {};
  for (const [key, value] of Object.entries(values)) {
    if (isOwn(key)) {
      patch[key] = value;
    } else {
      patch.filters = { ...patch.filters, [key]: value };
    }
  }
  return patch;
}

/** Everything saved for a page, as the patch that saves it again (Undo). */
export function prefsAsPatch(prefs: PagePrefs): PagePrefsPatch {
  const patch: PagePrefsPatch = patchOf(prefValues(prefs));
  if (prefs.sections && Object.keys(prefs.sections).length > 0) {
    patch.sections = { ...prefs.sections };
  }
  if (prefs.hidden && prefs.hidden.length > 0) patch.hidden = [...prefs.hidden];
  if (prefs.order && prefs.order.length > 0) patch.order = [...prefs.order];
  return patch;
}

/**
 * Two patches as one: the later wins key by key (coalescing quick
 * changes); `hidden` and `order` are whole lists, so the later one wins.
 */
export function mergePatches(
  a: PagePrefsPatch,
  b: PagePrefsPatch,
): PagePrefsPatch {
  const out: PagePrefsPatch = { ...a, ...b };
  if (a.filters || b.filters) out.filters = { ...a.filters, ...b.filters };
  if (a.sections || b.sections) {
    out.sections = { ...a.sections, ...b.sections };
  }
  return out;
}

/**
 * A page's preferences after `patch`: values set, `null`s cleared, maps
 * merged key by key, `hidden` and `order` replaced whole (an empty list
 * clears too); `undefined` when nothing is left.
 */
export function applyPagePatch(
  prefs: PagePrefs | undefined,
  patch: PagePrefsPatch,
): PagePrefs | undefined {
  const next: PagePrefs = { ...prefs };
  for (const key of OWN) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  if (patch.filters) {
    const filters = { ...next.filters };
    for (const [key, value] of Object.entries(patch.filters)) {
      if (value === null) delete filters[key];
      else filters[key] = value;
    }
    if (Object.keys(filters).length > 0) next.filters = filters;
    else delete next.filters;
  }
  if (patch.sections) {
    const sections = { ...next.sections };
    for (const [key, value] of Object.entries(patch.sections)) {
      if (value === null) delete sections[key];
      else sections[key] = value;
    }
    if (Object.keys(sections).length > 0) next.sections = sections;
    else delete next.sections;
  }
  for (const key of ['hidden', 'order'] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value === null || value.length === 0) delete next[key];
    else next[key] = [...value];
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * Sections a page has saved closed, and saved open; with `keys` (the
 * page's `sectionKeys`), only those.
 */
export function sectionCounts(
  prefs: PagePrefs,
  keys?: readonly string[],
): {
  closed: number;
  open: number;
} {
  const values = Object.entries(prefs.sections ?? {})
    .filter(([key]) => !keys || keys.includes(key))
    .map(([, value]) => value);
  return {
    closed: values.filter((v) => !v).length,
    open: values.filter(Boolean).length,
  };
}

/* ---------- hiding and ordering sections (#310) ---------- */

/**
 * A page, or a list of section keys in their default order: the helpers
 * below take either, so a page's rules and a test's list read the same.
 */
export type SectionSource = PageKey | readonly string[];

function keysOf(source: SectionSource): readonly string[] {
  return typeof source === 'string'
    ? (PAGES[source].sectionKeys ?? []).map((s) => s.key)
    : source;
}

/** A section's label in Settings → Pages; the key when it has none. */
export function sectionLabel(page: PageKey, key: string): string {
  return PAGES[page].sectionKeys?.find((s) => s.key === key)?.label ?? key;
}

/**
 * Every section the page has, shown or hidden, in the order it shows them:
 * the saved `order` first (keys the page does not have dropped, each once),
 * then each section the order does not name in its default place, right
 * after the one that comes before it by default (so a section a later
 * release adds lands where that release put it).
 */
export function sectionOrder(
  source: SectionSource,
  prefs: Pick<PagePrefs, 'order'>,
): string[] {
  const keys = keysOf(source);
  const known = new Set(keys);
  const out: string[] = [];
  for (const key of prefs.order ?? []) {
    if (known.has(key) && !out.includes(key)) out.push(key);
  }
  keys.forEach((key, i) => {
    if (out.includes(key)) return;
    const before = i === 0 ? -1 : out.indexOf(keys[i - 1] as string);
    out.splice(before + 1, 0, key);
  });
  return out;
}

/**
 * The sections a page renders, in order: `sectionOrder()` without the
 * hidden ones. Hiding every section is refused: a saved `hidden` that
 * names them all is ignored, and the page shows everything.
 */
export function visibleSections(
  source: SectionSource,
  prefs: Pick<PagePrefs, 'order' | 'hidden'>,
): string[] {
  const all = sectionOrder(source, prefs);
  const hidden = new Set(prefs.hidden ?? []);
  const shown = all.filter((key) => !hidden.has(key));
  return shown.length > 0 ? shown : all;
}

/** The sections the page leaves out, as it reads them (`visibleSections`). */
export function hiddenSections(
  source: SectionSource,
  prefs: Pick<PagePrefs, 'order' | 'hidden'>,
): Set<string> {
  const shown = new Set(visibleSections(source, prefs));
  return new Set(sectionOrder(source, prefs).filter((k) => !shown.has(k)));
}

/**
 * The change that shows or hides one section, as a `setPagePrefs` patch
 * (`hidden` saved whole, in the default order, only keys the page has;
 * `null` when nothing is left hidden), or `null` when there is nothing to
 * change: a key the page does not have, no change, or hiding the last
 * section shown.
 */
export function toggleSection(
  source: SectionSource,
  prefs: Pick<PagePrefs, 'order' | 'hidden'>,
  key: string,
  shown: boolean,
): PagePrefsPatch | null {
  const all = sectionOrder(source, prefs);
  if (!all.includes(key)) return null;
  const hidden = hiddenSections(source, prefs);
  if (hidden.has(key) === !shown) return null;
  if (shown) hidden.delete(key);
  else hidden.add(key);
  if (hidden.size >= all.length) return null;
  const next = keysOf(source).filter((k) => hidden.has(k));
  return { hidden: next.length > 0 ? next : null };
}

/**
 * The change that moves one section a place up (`-1`) or down (`1`)
 * among every section, hidden ones too (as Settings lists them), as a
 * patch saving `order` whole (`null` when it is back to the default), or
 * `null` at either end or for a key the page does not have.
 */
export function moveSection(
  source: SectionSource,
  prefs: Pick<PagePrefs, 'order'>,
  key: string,
  by: -1 | 1,
): PagePrefsPatch | null {
  const order = sectionOrder(source, prefs);
  const from = order.indexOf(key);
  const to = from + by;
  if (from < 0 || to < 0 || to >= order.length) return null;
  order.splice(from, 1);
  order.splice(to, 0, key);
  const keys = keysOf(source);
  const isDefault = order.every((k, i) => k === keys[i]);
  return { order: isDefault ? null : order };
}

/* ---------- carrying over the per-browser keys ---------- */

const KEY = /^[a-z][A-Za-z0-9:_-]*$/;
const okKey = (key: string) => KEY.test(key) && key.length <= LIMITS.prefKeyMax;
const okValue = (value: string) =>
  value.length > 0 && value.length <= LIMITS.prefValueMax;

/** The browser's old layout keys, `datapad:view:<page>`, by page. */
const LEGACY_VIEWS: Record<string, PageKey> = {
  focus: 'focus',
  projects: 'projects',
  archive: 'archive',
  tasks: 'tasks',
  meetings: 'meetings',
  notes: 'notes',
  people: 'people',
  'project-tasks': 'project',
};

/**
 * What this browser remembered before preferences were saved with the
 * data, as one patch per page: `datapad:view:<page>` (layouts),
 * `datapad:focus:<section>` (Focus's sections; its old buckets drop
 * out, as they are gone) and
 * `datapad:section:<project>:<section>` (a project page's sections, once
 * per project, now one set: closed where most projects had it closed).
 */
export function legacyPrefs(
  entries: Iterable<[string, string]>,
): Partial<Record<PageKey, PagePrefsPatch>> {
  const out: Partial<Record<PageKey, PagePrefsPatch>> = {};
  const add = (page: PageKey, patch: PagePrefsPatch) => {
    out[page] = mergePatches(out[page] ?? {}, patch);
  };
  const votes = new Map<string, number>();
  for (const [key, value] of entries) {
    if (key.startsWith('datapad:view:')) {
      const page = LEGACY_VIEWS[key.slice('datapad:view:'.length)];
      if (page && okValue(value)) add(page, { view: value });
    } else if (key.startsWith('datapad:focus:')) {
      const name = key.slice('datapad:focus:'.length);
      const known = (FOCUS_SECTIONS as readonly string[]).includes(name);
      if (known && (value === 'open' || value === 'closed')) {
        add('focus', { sections: { [name]: value === 'open' } });
      }
    } else if (key.startsWith('datapad:section:')) {
      const rest = key.slice('datapad:section:'.length);
      const name = rest.slice(rest.lastIndexOf(':') + 1);
      if (okKey(name) && (value === 'open' || value === 'closed')) {
        votes.set(name, (votes.get(name) ?? 0) + (value === 'open' ? 1 : -1));
      }
    }
  }
  for (const [name, vote] of votes) {
    add('project', { sections: { [name]: vote >= 0 } });
  }
  for (const page of PAGE_KEYS) {
    const patch = out[page];
    if (!patch) continue;
    // Within the limits, or not at all.
    for (const map of ['filters', 'sections'] as const) {
      const entries = Object.entries(patch[map] ?? {});
      const max =
        map === 'filters' ? LIMITS.prefFiltersMax : LIMITS.prefSectionsMax;
      if (entries.length > max) {
        patch[map] = Object.fromEntries(entries.slice(0, max));
      }
    }
  }
  return out;
}

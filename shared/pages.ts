import {
  ALL_LAYOUTS,
  type AllSortDefaults,
  KIND_LABELS,
  LAYOUT_SETTING,
  type LayoutKind,
} from './all';
import { LIMITS } from './limits';
import { LIST_SORTS } from './lists';
import { PROJECT_SORTS } from './projects';
import type { PagePrefsPatch } from './protocol';
import { type AllKind, kindsOf } from './routes';
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
import { DEFAULT_TASK_FILTERS, TASK_SORTS } from './tasks';
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
 * and Mine when a person is marked as me (Focus's Tasks for, #311);
 * `kinds` is some of All's kinds, or every kind (#343).
 */
export type PrefKind = 'who' | 'me' | 'project' | 'org' | 'kinds';

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
  /** The control the page uses for it, which Settings reuses. */
  control: 'segmented' | 'select';
  /**
   * Set in Settings only, never in the address (#310): a threshold
   * or a display choice with no business in a link. Saved under `filters`
   * like any other key and read with `currentValues()` (or the
   * `usePageSetting()` hook); `effectiveQuery()` and `planChange()` leave
   * the address alone for it, and it is not a filter (`filterFields()`).
   */
  settingsOnly?: true;
  /**
   * A layout field other than `view` (All's per kind, #338): the page as
   * Help's Layouts table names it.
   */
  layoutOf?: string;
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
   * Settings counts them.
   */
  collapsible?: readonly string[];
  /**
   * The sections the page can hide and put in another order (#310), in
   * their default order, each with its label for Settings. Set
   * once the page renders them through `usePageSections()`; a saved key
   * that is not one is ignored.
   */
  sectionKeys?: readonly PageSection[];
  /**
   * Whether those sections keep their own order: they can be hidden but
   * not moved (meeting mode's, #336, whose layout is fixed).
   */
  fixedOrder?: true;
  /**
   * A classic page v2 replaced (#341). What it saved is kept, read once
   * to carry it over (`legacyPrefs()`, `migrateSettings()`), and no page
   * or Help shows it.
   */
  retired?: true;
}

/**
 * Today's lanes (#331), which collapse, hide and move: Mine, Waiting on
 * and To decide. Kept under the `focus` key, so what Focus saved
 * (Waiting on's open or closed, its place) carries over; Focus's other
 * sections are gone.
 */
export const FOCUS_SECTIONS = ['mine', 'waiting', 'decide'] as const;

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
 * Today's settings (#331, #343), set in Settings → Today only. The first
 * two are what Focus saved (#311), under the same keys, so Focus's carry
 * over as they are: `who` is what Mine holds (Focus's Tasks for: Anyone
 * reads as Mine and unassigned, Mine as only what is assigned to me), and
 * `days` how far Next up looks ahead (Focus's Week window). `weekStart`
 * is the day the week zoom and the recap's weekend start from (MCP's
 * `get_recap` too), and `brief` whether Today offers Brief me. Focus's
 * other rules (`target`, `quiet`, `yellow`, `followDays`) stay saved;
 * Brief me still reads Attention's (`savedFocusOptions`); Settings no
 * longer shows them. MCP's `get_today` (and `get_focus`, its alias)
 * reads `who` and `days` as Today does.
 */
const todayFields: readonly PrefField[] = [
  {
    key: 'who',
    label: 'Mine shows',
    def: 'anyone',
    options: [
      { value: 'anyone', label: 'Mine and unassigned' },
      { value: 'mine', label: 'Only assigned to me' },
    ],
    control: 'select',
    settingsOnly: true,
  },
  {
    key: 'days',
    label: 'Next up looks ahead',
    def: String(FOCUS_DAYS),
    options: dayOptions(FOCUS_DAY_CHOICES),
    control: 'select',
    settingsOnly: true,
  },
  {
    key: 'weekStart',
    label: 'Week starts on',
    def: 'mon',
    options: [
      { value: 'mon', label: 'Monday' },
      { value: 'sun', label: 'Sunday' },
    ],
    control: 'segmented',
    settingsOnly: true,
  },
  {
    key: 'brief',
    label: 'Brief me',
    def: 'on',
    options: [
      { value: 'on', label: 'On' },
      { value: 'off', label: 'Off' },
    ],
    control: 'segmented',
    settingsOnly: true,
  },
];

/** Whether Today offers Brief me, from its saved values. */
export function briefOn(value: string | null | undefined): boolean {
  return value !== 'off';
}

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
    weekStart: values.weekStart === 'sun' ? 'sun' : d.weekStart,
  };
}

/** Focus's settings as saved for the space (Brief me, MCP's `get_today` and `get_recap`). */
export function savedFocusOptions(
  snapshot: Pick<Snapshot, 'settings' | 'people' | 'projects' | 'orgs'>,
): FocusOptions {
  // The raw values: `focusOptions` checks each one, and Focus's rules
  // that Today has no field for still count.
  return focusOptions(
    prefValues(savedPrefs(snapshot, 'focus')),
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
 * A project room's sections (#334): its three lanes, which hide and move
 * as Today's do. What the project page saved for its old sections (#312)
 * is ignored; Activity, under Plan, still remembers open or closed.
 */
export const PROJECT_ROOM_SECTIONS: readonly PageSection[] = [
  { key: 'mine', label: 'Mine' },
  { key: 'waiting', label: 'Waiting on' },
  { key: 'decide', label: 'To decide' },
];

/**
 * A person's room's sections (#335): its three lanes under the room's
 * names (the keys are the lanes' own), which hide and move as the
 * project room's do.
 */
export const PERSON_ROOM_SECTIONS: readonly PageSection[] = [
  { key: 'mine', label: 'You owe' },
  { key: 'waiting', label: 'They owe you' },
  { key: 'decide', label: 'To discuss' },
];

/** How the task page shows the note a task was made from (#312). */
export const SOURCE_NOTE_OPTIONS = [
  { value: 'expanded', label: 'Expanded' },
  { value: 'collapsed', label: 'Collapsed' },
  { value: 'hidden', label: 'Hidden' },
] as const;

const sourceNoteField: PrefField = {
  key: 'sourceNote',
  label: 'Source note',
  def: 'expanded',
  options: SOURCE_NOTE_OPTIONS,
  control: 'segmented',
  settingsOnly: true,
};

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

/** A Show · Hide choice set in Settings only (#313). */
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

/**
 * All's layouts (#338): the one each kind opens with when it is shown
 * alone, set in Settings → All or by switching layout on All, never in
 * the address (`?view=` there says what one link shows).
 */
const allLayoutFields: readonly PrefField[] = (
  Object.keys(ALL_LAYOUTS) as LayoutKind[]
).map((kind) => ({
  key: LAYOUT_SETTING[kind],
  label: `${KIND_LABELS[kind]} layout`,
  def: 'list',
  options: ALL_LAYOUTS[kind],
  control: 'segmented',
  settingsOnly: true,
  layoutOf: `All, ${KIND_LABELS[kind].toLowerCase()}`,
}));

/** The setting that holds the kinds All opens with (#343). */
export const ALL_KINDS_SETTING = 'kinds';

/** The value that saves "every kind" as All's opening kinds. */
export const EVERY_KIND = 'all';

/** The kinds All opens with when nothing is set: Tasks. */
export const DEFAULT_ALL_KINDS: readonly AllKind[] = ['task'];

/**
 * The kinds All opens with, from the saved value: the kinds named, `all`
 * for every kind (empty), else Tasks.
 */
export function allHomeKinds(value: string | null | undefined): AllKind[] {
  if (value === EVERY_KIND) return [];
  const kinds = kindsOf(value ?? null);
  return kinds.length > 0 ? kinds : [...DEFAULT_ALL_KINDS];
}

/** The value that saves `kinds` as All's opening kinds. */
export function allHomeValue(kinds: readonly AllKind[]): string {
  const named = kindsOf(kinds.join(','));
  return named.length > 0 ? named.join(',') : EVERY_KIND;
}

/**
 * All's default sorts (#343): the sort a kind alone starts with, for the
 * two kinds with sorts of their own. Set in Settings → All only.
 */
export const ALL_SORT_SETTING = {
  task: 'taskSort',
  project: 'projectSort',
} as const;

/** All's saved default sorts, by kind, as `shared/all.ts` takes them. */
export function allSortDefaults(
  values: Readonly<Record<string, string | undefined>>,
): AllSortDefaults {
  const out: AllSortDefaults = {};
  const task = values[ALL_SORT_SETTING.task];
  if (task && (TASK_SORTS as readonly string[]).includes(task)) out.task = task;
  const project = values[ALL_SORT_SETTING.project];
  if (project && (PROJECT_SORTS as readonly string[]).includes(project)) {
    out.project = project;
  }
  return out;
}

const allFields: readonly PrefField[] = [
  {
    key: ALL_KINDS_SETTING,
    label: 'Opens on',
    def: DEFAULT_ALL_KINDS.join(','),
    kind: 'kinds',
    control: 'select',
    settingsOnly: true,
  },
  ...allLayoutFields,
  {
    key: ALL_SORT_SETTING.task,
    label: 'Tasks sort by',
    def: DEFAULT_TASK_FILTERS.sort,
    options: TASK_SORT_OPTIONS,
    control: 'select',
    settingsOnly: true,
  },
  {
    key: ALL_SORT_SETTING.project,
    label: 'Projects sort by',
    def: 'updated',
    options: PROJECT_SORT_OPTIONS,
    control: 'select',
    settingsOnly: true,
  },
];

/** What each page remembers. */
export const PAGES: Record<PageKey, PageSpec> = {
  focus: {
    label: 'Today',
    fields: todayFields,
    sections: true,
    collapsible: FOCUS_SECTIONS,
    sectionKeys: [
      { key: 'mine', label: 'Mine' },
      { key: 'waiting', label: 'Waiting on' },
      { key: 'decide', label: 'To decide' },
    ],
  },
  all: {
    label: 'All',
    fields: allFields,
    sections: false,
  },
  projects: {
    retired: true,
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
    retired: true,
    label: 'Archived',
    fields: [layout(PROJECT_LAYOUTS, 'cards'), projectSort],
    sections: false,
  },
  tasks: {
    retired: true,
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
    retired: true,
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
    retired: true,
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
    retired: true,
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
    label: 'Project room',
    fields: [],
    sections: true,
    sectionKeys: PROJECT_ROOM_SECTIONS,
    collapsible: [
      ...PROJECT_ROOM_SECTIONS.map((s) => s.key),
      'milestones',
      'activity',
    ],
  },
  person: {
    label: 'Person room',
    fields: [],
    sections: true,
    sectionKeys: PERSON_ROOM_SECTIONS,
    collapsible: PERSON_ROOM_SECTIONS.map((s) => s.key),
  },
  task: {
    retired: true,
    label: 'Task page',
    fields: [sourceNoteField],
    sections: true,
    collapsible: ['notes'],
  },
  meeting: {
    label: 'Meeting mode',
    fields: [
      showHide('covered', 'Covered topics'),
      showHide('doneActions', 'Done action items'),
    ],
    sections: false,
    sectionKeys: MEETING_SECTIONS,
    fixedOrder: true,
  },
  list: {
    retired: true,
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
 * Every page's layouts (not a retired page's), for Help's Layouts table: each page's `view` and
 * each per-kind layout (All's), with its options and the one it opens as.
 */
export function layoutTable(): {
  page: string;
  options: readonly PrefOption[];
  def: string;
}[] {
  return Object.values(PAGES)
    .filter((page) => !page.retired)
    .flatMap((page) =>
      page.fields
        .filter((f) => f.options && (f.key === 'view' || f.layoutOf))
        .map((f) => ({
          page: f.layoutOf ?? page.label,
          options: f.options ?? [],
          def: f.options?.find((o) => o.value === f.def)?.label ?? '',
        })),
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
    case 'kinds':
      return value === EVERY_KIND || kindsOf(value).join(',') === value;
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
  if (prefs.views && prefs.views.length > 0) {
    patch.views = prefs.views.map((v) => ({ ...v }));
  }
  return patch;
}

/**
 * Two patches as one: the later wins key by key (coalescing quick
 * changes); `hidden`, `order` and `views` are whole lists, so the later
 * one wins.
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
 * merged key by key, `hidden`, `order` and `views` replaced whole (an
 * empty list clears too); `undefined` when nothing is left.
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
  if (patch.views !== undefined) {
    if (patch.views === null || patch.views.length === 0) delete next.views;
    else next.views = patch.views.map((v) => ({ ...v }));
  }
  return Object.keys(next).length > 0 ? next : undefined;
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

/** The kinds All opens with in this space (Settings → All, #343). */
export function allHome(
  snapshot: Pick<Snapshot, 'settings' | 'people' | 'projects' | 'orgs'>,
): AllKind[] {
  const values = currentValues('all', savedPrefs(snapshot, 'all'), snapshot);
  return allHomeKinds(values[ALL_KINDS_SETTING]);
}

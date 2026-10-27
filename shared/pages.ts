import { LIMITS } from './limits';
import { PROJECT_SORTS } from './projects';
import type { PagePrefsPatch } from './protocol';
import { meId, orgs } from './select';
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
 * and the one-time carry-over from the per-browser keys used before.
 * `src/providers/PagePrefsProvider.tsx` holds the debounced saving.
 */

export interface PrefOption {
  value: string;
  label: string;
}

/** A list that comes from the data rather than the page. */
export type PrefKind = 'who' | 'project' | 'org';

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
  kind?: PrefKind;
  /** The control the page uses for it, which Settings → Pages reuses. */
  control: 'segmented' | 'select';
}

export interface PageSpec {
  label: string;
  /** The layout first, then the page's other remembered controls. */
  fields: readonly PrefField[];
  /** Whether the page has sections that remember open or closed. */
  sections: boolean;
  /**
   * The keys of those sections, when the page names them: a saved key
   * that is not one (a section an older release had) is ignored.
   */
  sectionKeys?: readonly string[];
}

/**
 * Focus's collapsible sections (#206): Waiting on, Attention and
 * Follow-ups. The buckets that used to be sections (Blocked, This week,
 * Later, No date, and Day's `day:` copies) are gone.
 */
export const FOCUS_SECTIONS = ['waiting', 'attention', 'followUps'] as const;

const PROJECT_LAYOUTS = [
  { value: 'cards', label: 'Cards' },
  { value: 'table', label: 'Table' },
  { value: 'timeline', label: 'Timeline' },
];

function layout(
  options: readonly PrefOption[],
  def: string,
  label = 'Layout',
): PrefField {
  return { key: 'view', label, def, options, control: 'segmented' };
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

/** Tasks' Show filter. */
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
      who,
    ],
    sections: true,
    sectionKeys: FOCUS_SECTIONS,
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
      {
        key: 'sort',
        label: 'Sort by',
        def: 'updated',
        options: PROJECT_SORT_OPTIONS,
        control: 'select',
      },
    ],
    sections: false,
  },
  archive: {
    label: 'Archived',
    fields: [layout(PROJECT_LAYOUTS, 'cards')],
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
        label: 'Show',
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
        options: TASK_SORTS.map((s) => ({
          value: s,
          label: TASK_SORT_LABELS[s],
        })),
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
      layout(
        [
          { value: 'feed', label: 'Feed' },
          { value: 'grid', label: 'Grid' },
        ],
        'feed',
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
    ],
    sections: true,
  },
};

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
    const value = saved[field.key];
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
    const value = saved[field.key];
    if (value !== undefined && !out.has(field.key)) out.set(field.key, value);
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
  return patch;
}

/** Two patches as one: the later wins key by key (coalescing quick changes). */
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
 * merged key by key; `undefined` when nothing is left.
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

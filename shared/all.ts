import { selectMeetings } from './meetings';
import { mentionedIds } from './mentions';
import { queryWords, selectNotes } from './notes';
import {
  compareProjects,
  PROJECT_SORTS,
  type ProjectSort,
  selectProjects,
} from './projects';
import { ALL_KINDS, type AllKind, kindsOf, type Route } from './routes';
import { meId } from './select';
import {
  DEFAULT_TASK_FILTERS,
  DUE_BUCKETS,
  type DueBucket,
  dueBucket,
  selectTasks,
  TASK_SORTS,
  type TaskSortKey,
} from './tasks';
import {
  blockedOf,
  type DateString,
  decideOf,
  type Meeting,
  type Note,
  type Person,
  type Project,
  type SavedView,
  type Snapshot,
  type Task,
} from './types';

/**
 * All (#337), the pure half: what its address means (kinds, Find,
 * filters, sort), which filters fit the kinds shown, and the rows. Each
 * kind is chosen by its own selector (`selectTasks`, `selectNotes`,
 * `selectMeetings`, `selectProjects`), so a kind on its own filters and
 * sorts as its page did before v2; All adds the filters that cut across
 * kinds and, for several kinds at once, one sort over them all.
 */

/** Where an item stands, for Status. */
export const ALL_STATUSES = ['open', 'done', 'archived', 'all'] as const;
export type AllStatus = (typeof ALL_STATUSES)[number];

export const ALL_STATUS_OPTIONS: readonly {
  value: AllStatus;
  label: string;
}[] = [
  { value: 'open', label: 'Open' },
  { value: 'done', label: 'Done or past' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
];

/** The sorts for several kinds at once (or notes, meetings or people). */
export const MIXED_SORTS = ['updated', 'title', 'date'] as const;
export type MixedSort = (typeof MIXED_SORTS)[number];

export const MIXED_SORT_OPTIONS: readonly {
  value: MixedSort;
  label: string;
}[] = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'title', label: 'Title' },
  { value: 'date', label: 'Date' },
];

export interface AllFilters {
  /** The kinds shown; empty is every kind. */
  kinds: AllKind[];
  /** Find's words. */
  q: string;
  /** `''` any, `general` for General, or a project id. */
  room: string;
  /** `''` anyone, `me` for the person marked as you, or a person id. */
  person: string;
  status: AllStatus;
  /** A task's due bucket; `''` any. */
  due: DueBucket | '';
  /** A task's or project's tag, as written; `''` any. */
  tag: string;
  /** Only tasks to decide. */
  decide: boolean;
  /** Only tasks waiting on someone. */
  waiting: boolean;
  /** One of `sortsFor(kinds)`. */
  sort: string;
  dir: 'asc' | 'desc';
  /**
   * The layout asked for in the address (#338), one of `layoutsFor(kinds)`;
   * `''` is the saved default for the kind (`allLayout`).
   */
  view: string;
  /** The task board's columns: by status or by priority. */
  board: BoardBy;
}

/* ---------- layouts (#338) ---------- */

/** The kinds with layouts other than the list. */
export type LayoutKind = 'task' | 'meeting' | 'project';

export type LayoutOption = { value: string; label: string };

/**
 * The layouts each kind is offered when it is shown alone, the list first
 * (every kind's default): tasks as a list, a table or a board, meetings as
 * a list or a calendar, projects as a list, cards or a timeline.
 */
export const ALL_LAYOUTS: Record<LayoutKind, readonly LayoutOption[]> = {
  task: [
    { value: 'list', label: 'List' },
    { value: 'table', label: 'Table' },
    { value: 'board', label: 'Board' },
  ],
  meeting: [
    { value: 'list', label: 'List' },
    { value: 'calendar', label: 'Calendar' },
  ],
  project: [
    { value: 'list', label: 'List' },
    { value: 'cards', label: 'Cards' },
    { value: 'timeline', label: 'Timeline' },
  ],
};

/** Where each kind's default layout is saved (Settings → All). */
export const LAYOUT_SETTING: Record<LayoutKind, string> = {
  task: 'taskView',
  meeting: 'meetingView',
  project: 'projectView',
};

/** The task board's columns. */
export const BOARD_BY = ['status', 'priority'] as const;
export type BoardBy = (typeof BOARD_BY)[number];

/** The kind whose layouts the switcher offers: one kind shown alone. */
export function layoutKind(kinds: readonly AllKind[]): LayoutKind | null {
  const only = kinds.length === 1 ? kinds[0] : undefined;
  return only === 'task' || only === 'meeting' || only === 'project'
    ? only
    : null;
}

/** The layouts offered for `kinds`; none (the list alone) for several. */
export function layoutsFor(kinds: readonly AllKind[]): readonly LayoutOption[] {
  const kind = layoutKind(kinds);
  return kind ? ALL_LAYOUTS[kind] : [];
}

/**
 * The layout All shows: the address's, else the kind's saved default
 * (`saved`, by setting key), else the list. A layout the kind does not
 * have reads as the next one down.
 */
export function allLayout(
  filters: Pick<AllFilters, 'kinds' | 'view'>,
  saved: Readonly<Record<string, string>> = {},
): string {
  const kind = layoutKind(filters.kinds);
  if (!kind) return 'list';
  const has = (v: string | undefined): v is string =>
    Boolean(v) && ALL_LAYOUTS[kind].some((o) => o.value === v);
  if (has(filters.view)) return filters.view;
  const def = saved[LAYOUT_SETTING[kind]];
  return has(def) ? def : 'list';
}

/** The filters, each a query key; Find, the kinds and the sort are not. */
export type AllFilterKey =
  | 'room'
  | 'person'
  | 'status'
  | 'due'
  | 'tag'
  | 'decide'
  | 'waiting';

/** The kinds each filter fits. A person fits Room as a project's member. */
const FITS: Record<AllFilterKey, readonly AllKind[]> = {
  room: ['task', 'note', 'meeting', 'project', 'person'],
  person: ['task', 'note', 'meeting', 'project', 'person'],
  status: ['task', 'note', 'meeting', 'project'],
  due: ['task'],
  tag: ['task', 'project'],
  decide: ['task'],
  waiting: ['task'],
};

/** The kinds shown: those chosen, or every kind. */
export function shownKinds(kinds: readonly AllKind[]): AllKind[] {
  return kinds.length > 0 ? [...kinds] : [...ALL_KINDS];
}

/**
 * The filters the toolbar offers for `kinds`: those that fit at least one
 * of them. One that does not is not shown and does not apply.
 */
export function filtersFor(kinds: readonly AllKind[]): AllFilterKey[] {
  const shown = shownKinds(kinds);
  return (Object.keys(FITS) as AllFilterKey[]).filter((key) =>
    FITS[key].some((kind) => shown.includes(kind)),
  );
}

export type SortOption = { value: string; label: string };

const TASK_SORT_LABELS: Record<TaskSortKey, string> = {
  title: 'Title',
  project: 'Project',
  priority: 'Priority',
  due: 'Due',
  assignee: 'Assignee',
  updated: 'Updated',
};

const PROJECT_SORT_LABELS: Record<ProjectSort, string> = {
  updated: 'Recently updated',
  priority: 'Priority',
  name: 'Name',
  start: 'Start date',
  target: 'Target date',
  milestone: 'Next milestone',
};

/**
 * The sorts for `kinds`: tasks alone sort as Tasks did, projects alone as
 * Projects did; anything else has the mixed sorts.
 */
export function sortsFor(kinds: readonly AllKind[]): SortOption[] {
  const only = kinds.length === 1 ? kinds[0] : undefined;
  if (only === 'task') {
    return TASK_SORTS.map((s) => ({ value: s, label: TASK_SORT_LABELS[s] }));
  }
  if (only === 'project') {
    return PROJECT_SORTS.map((s) => ({
      value: s,
      label: PROJECT_SORT_LABELS[s],
    }));
  }
  return [...MIXED_SORT_OPTIONS];
}

/**
 * The sort `kinds` start with: Tasks' (due), Projects' (recently
 * updated), meetings soonest first, people by name, else recently
 * updated.
 */
export function defaultSort(
  kinds: readonly AllKind[],
  sorts: AllSortDefaults = {},
): string {
  const only = kinds.length === 1 ? kinds[0] : undefined;
  const own = (only === 'task' || only === 'project') && sorts[only];
  if (own && sortsFor(kinds).some((o) => o.value === own)) return own;
  if (only === 'task') return DEFAULT_TASK_FILTERS.sort;
  if (only === 'meeting') return 'date';
  if (only === 'person') return 'title';
  return 'updated';
}

/**
 * The sorts a kind alone starts with when the owner set one (Settings →
 * All, #343), by kind; a kind left out starts with `defaultSort`'s.
 */
export type AllSortDefaults = Partial<Record<'task' | 'project', string>>;

/** The defaults, for `kinds`, with the owner's default sorts. */
export function defaultAllFilters(
  kinds: readonly AllKind[] = [],
  sorts: AllSortDefaults = {},
): AllFilters {
  return {
    kinds: [...kinds],
    q: '',
    room: '',
    person: '',
    status: 'open',
    due: '',
    tag: '',
    decide: false,
    waiting: false,
    sort: defaultSort(kinds, sorts),
    dir: 'asc',
    view: '',
    board: 'status',
  };
}

/**
 * All's filters from its query. A value All does not have reads as the
 * default, as does a sort the kinds do not have; no sort is the kind's
 * default (`sorts`, the owner's, else `defaultSort`'s).
 */
export function parseAllQuery(
  params: URLSearchParams,
  sorts: AllSortDefaults = {},
): AllFilters {
  const kinds = kindsOf(params.get('kind'));
  const d = defaultAllFilters(kinds, sorts);
  const status = params.get('status');
  const due = params.get('due');
  const sort = params.get('sort') ?? '';
  const view = params.get('view') ?? '';
  return {
    kinds,
    q: params.get('q') ?? '',
    room: params.get('room') ?? '',
    person: params.get('person') ?? '',
    status: (ALL_STATUSES as readonly string[]).includes(status ?? '')
      ? (status as AllStatus)
      : d.status,
    due: DUE_BUCKETS.some((b) => b.id === due) ? (due as DueBucket) : '',
    tag: params.get('tag') ?? '',
    decide: params.get('decide') === '1',
    waiting: params.get('waiting') === '1',
    sort: sortsFor(kinds).some((o) => o.value === sort) ? sort : d.sort,
    dir: params.get('dir') === 'desc' ? 'desc' : 'asc',
    view: layoutsFor(kinds).some((o) => o.value === view) ? view : '',
    board:
      params.get('board') === 'priority' && layoutKind(kinds) === 'task'
        ? 'priority'
        : 'status',
  };
}

/**
 * The query for `filters`, every key set or cleared (`null`) so it can
 * replace the page's: defaults are left out, so a plain All is `/all`.
 * The kinds are the route's (`?kind=`), not here.
 */
export function allQuery(
  filters: AllFilters,
  sorts: AllSortDefaults = {},
): Record<string, string | null> {
  const d = defaultAllFilters(filters.kinds, sorts);
  const value = (v: string, def: string) => (v && v !== def ? v : null);
  return {
    q: value(filters.q, ''),
    room: value(filters.room, ''),
    person: value(filters.person, ''),
    status: value(filters.status, d.status),
    due: value(filters.due, ''),
    tag: value(filters.tag, ''),
    decide: filters.decide ? '1' : null,
    waiting: filters.waiting ? '1' : null,
    sort: value(filters.sort, d.sort),
    dir: filters.dir === 'desc' ? 'desc' : null,
    view: filters.view || null,
    board:
      filters.board === 'priority' && layoutKind(filters.kinds) === 'task'
        ? 'priority'
        : null,
  };
}

/** The filters on and away from their defaults (not Find, not the sort). */
export function activeAllFilters(filters: AllFilters): AllFilterKey[] {
  const offered = filtersFor(filters.kinds);
  const on: Record<AllFilterKey, boolean> = {
    room: filters.room !== '',
    person: filters.person !== '',
    status: filters.status !== 'open',
    due: filters.due !== '',
    tag: filters.tag !== '',
    decide: filters.decide,
    waiting: filters.waiting,
  };
  return offered.filter((key) => on[key]);
}

/**
 * Every filter and Find back to the default; the kinds, sort and layout
 * stay.
 */
export function clearedAllFilters(filters: AllFilters): AllFilters {
  return {
    ...defaultAllFilters(filters.kinds),
    sort: filters.sort,
    dir: filters.dir,
    view: filters.view,
    board: filters.board,
  };
}

export type AllRow =
  | { kind: 'task'; id: string; item: Task }
  | { kind: 'note'; id: string; item: Note }
  | { kind: 'meeting'; id: string; item: Meeting }
  | { kind: 'project'; id: string; item: Project }
  | { kind: 'person'; id: string; item: Person };

type State = Pick<
  Snapshot,
  'tasks' | 'notes' | 'meetings' | 'projects' | 'people'
>;

/** Whether an item's project is archived (a project: whether it is). */
function inArchive(row: AllRow, projects: Snapshot['projects']): boolean {
  if (row.kind === 'project') return row.item.archived;
  if (row.kind === 'person') return false;
  const id = row.item.projectId;
  return id !== null && Boolean(projects[id]?.archived);
}

/**
 * Where a row stands: archived with its project (or as one), done (a
 * closed task, a past meeting, a finished project), else open. Notes and
 * people are open unless archived.
 */
export function rowStatus(
  row: AllRow,
  projects: Snapshot['projects'],
  today: DateString,
): Exclude<AllStatus, 'all'> {
  if (inArchive(row, projects)) return 'archived';
  switch (row.kind) {
    case 'task':
      return row.item.status === 'done' ? 'done' : 'open';
    case 'meeting':
      return row.item.date < today ? 'done' : 'open';
    case 'project':
      return row.item.status === 'done' ? 'done' : 'open';
    default:
      return 'open';
  }
}

/** Whether a row is in `room` (a person: a member of that project). */
function inRoom(row: AllRow, room: string, projects: State['projects']) {
  const projectId = room === 'general' ? null : room;
  switch (row.kind) {
    case 'project':
      return row.id === projectId;
    case 'person':
      return Boolean(
        projectId && projects[projectId]?.members.includes(row.id),
      );
    default:
      return row.item.projectId === projectId;
  }
}

/**
 * Whether a row is `person`'s: a task assigned to them or waiting on them,
 * a note that mentions them, a meeting they attend, a project they are a
 * member of, or the person.
 */
function ofPerson(row: AllRow, person: string): boolean {
  switch (row.kind) {
    case 'task':
      return row.item.assignee === person || blockedOf(row.item)?.on === person;
    case 'note':
      return mentionedIds(row.item.body).includes(person);
    case 'meeting':
      return row.item.attendees.includes(person);
    case 'project':
      return row.item.members.includes(person);
    case 'person':
      return row.id === person;
  }
}

/** The person a Person filter names, or null for anyone. */
function personOf(filters: AllFilters, people: State['people']): string | null {
  if (!filters.person) return null;
  if (filters.person === 'me') return meId(people) ?? '';
  return filters.person;
}

const lower = (s: string) => s.toLowerCase();

/** A row's title, for the mixed Title sort. */
export function rowTitle(row: AllRow): string {
  switch (row.kind) {
    case 'task':
    case 'meeting':
      return row.item.title;
    case 'note':
      return row.item.body.trim();
    default:
      return row.item.name;
  }
}

/** When a row last changed, for Recently updated. */
function rowUpdated(row: AllRow): string {
  switch (row.kind) {
    case 'task':
    case 'project':
      return row.item.updatedAt;
    case 'note':
      return row.item.editedAt ?? row.item.createdAt;
    case 'meeting':
      return row.item.updatedAt;
    case 'person':
      return '';
  }
}

/**
 * A row's day, for the mixed Date sort: a task's due date, a meeting's
 * day, a project's target, the day a note was written; a person has none.
 */
function rowDate(row: AllRow): string {
  switch (row.kind) {
    case 'task':
      return row.item.due;
    case 'meeting':
      return `${row.item.date} ${row.item.time}`;
    case 'project':
      return row.item.targetDate;
    case 'note':
      return row.item.createdAt.slice(0, 10);
    case 'person':
      return '';
  }
}

/** The mixed sorts, `dir` applied; undated (and unchanged) last either way. */
function compareMixed(sort: MixedSort, dir: 1 | -1) {
  const byTitle = (a: AllRow, b: AllRow) =>
    rowTitle(a).localeCompare(rowTitle(b));
  if (sort === 'title') return (a: AllRow, b: AllRow) => dir * byTitle(a, b);
  const keyOf = sort === 'date' ? rowDate : rowUpdated;
  // Recently updated is newest first when ascending, as Projects' is.
  const way = sort === 'updated' ? -dir : dir;
  return (a: AllRow, b: AllRow) => {
    const x = keyOf(a);
    const y = keyOf(b);
    if (x === y) return byTitle(a, b);
    if (!x) return 1;
    if (!y) return -1;
    return way * x.localeCompare(y);
  };
}

/** People whose name or role has every word of Find. */
function personMatches(person: Person, q: string): boolean {
  const words = queryWords(q);
  const text = lower(`${person.name}\n${person.role}`);
  return words.every((w) => text.includes(w));
}

/**
 * The rows All shows for `filters`: each kind picked by its own selector
 * with Find, then the filters that fit it (a filter that does not fit a
 * kind leaves that kind out while it is on), then sorted. One kind alone
 * keeps its selector's order (Tasks' and Projects' sorts, notes newest
 * first, meetings soonest first, people by name) unless a mixed sort is
 * chosen; several are sorted together.
 */
export function selectAll(
  state: State,
  filters: AllFilters,
  today: DateString,
  hiddenNotes: ReadonlySet<string> = new Set(),
): AllRow[] {
  const kinds = shownKinds(filters.kinds);
  const offered = filtersFor(filters.kinds);
  const active = activeAllFilters(filters);
  // Status is for every kind it fits; the rest leave out what they do not.
  const want = (kind: AllKind) =>
    kinds.includes(kind) &&
    active.every((key) => key === 'status' || FITS[key].includes(kind));
  const byStatus = offered.includes('status') && filters.status !== 'all';
  const me = meId(state.people);
  const dir = filters.dir === 'desc' ? 'desc' : 'asc';
  const alone = filters.kinds.length === 1;
  const taskSort = (
    alone && filters.kinds[0] === 'task' ? filters.sort : 'title'
  ) as TaskSortKey;
  const projectSort = (
    alone && filters.kinds[0] === 'project' ? filters.sort : 'name'
  ) as ProjectSort;

  let rows: AllRow[] = [];
  if (want('task')) {
    const tasks =
      selectTasks(
        state,
        {
          ...DEFAULT_TASK_FILTERS,
          status: 'all',
          group: 'none',
          q: filters.q,
          sort: taskSort,
          dir,
        },
        today,
        me,
      )[0]?.rows ?? [];
    rows.push(
      ...tasks.map((item) => ({ kind: 'task' as const, id: item.id, item })),
    );
  }
  if (want('note')) {
    const notes = selectNotes(
      state,
      {
        project: filters.room,
        pinned: false,
        q: filters.q,
        archived: filters.status !== 'open',
      },
      hiddenNotes,
    );
    rows.push(
      ...notes.map((item) => ({ kind: 'note' as const, id: item.id, item })),
    );
  }
  if (want('meeting')) {
    const meetings = selectMeetings(
      state.meetings,
      { project: filters.room, q: filters.q },
      state.people,
    );
    rows.push(
      ...meetings.map((item) => ({
        kind: 'meeting' as const,
        id: item.id,
        item,
      })),
    );
  }
  if (want('project')) {
    const select = (archived: boolean) =>
      selectProjects(
        state.projects,
        { status: 'all', health: '', org: '', sort: projectSort, q: filters.q },
        archived,
        today,
      );
    const projects = [...select(false), ...select(true)].sort(
      compareProjects(projectSort, today),
    );
    if (dir === 'desc' && alone) projects.reverse();
    rows.push(
      ...projects.map((item) => ({
        kind: 'project' as const,
        id: item.id,
        item,
      })),
    );
  }
  if (want('person')) {
    const people = Object.values(state.people)
      .filter((p) => personMatches(p, filters.q))
      .sort((a, b) => a.name.localeCompare(b.name));
    rows.push(
      ...people.map((item) => ({ kind: 'person' as const, id: item.id, item })),
    );
  }

  const person = personOf(filters, state.people);
  const tag = lower(filters.tag);
  rows = rows.filter((row) => {
    if (byStatus && rowStatus(row, state.projects, today) !== filters.status) {
      return false;
    }
    if (filters.room && !inRoom(row, filters.room, state.projects)) {
      return false;
    }
    if (person !== null && !ofPerson(row, person)) return false;
    if (row.kind === 'task') {
      if (filters.due && dueBucket(row.item, today) !== filters.due) {
        return false;
      }
      if (filters.decide && !decideOf(row.item)) return false;
      if (filters.waiting && !blockedOf(row.item)) return false;
    }
    if (tag && (row.kind === 'task' || row.kind === 'project')) {
      if (!row.item.tags.some((t) => lower(t) === tag)) return false;
    }
    return true;
  });

  // A kind alone at its first sort keeps its selector's order.
  const only = alone ? filters.kinds[0] : undefined;
  const ownOrder =
    only === 'task' ||
    only === 'project' ||
    (only !== undefined &&
      filters.sort === defaultSort(filters.kinds) &&
      dir === 'asc');
  if (ownOrder) return rows;
  return rows.sort(
    compareMixed(filters.sort as MixedSort, dir === 'desc' ? -1 : 1),
  );
}

/** Every tag on a task or project, each once (ignoring case), A to Z. */
export function allTags(state: Pick<Snapshot, 'tasks' | 'projects'>): string[] {
  const seen = new Map<string, string>();
  for (const item of [
    ...Object.values(state.tasks),
    ...Object.values(state.projects),
  ]) {
    for (const tag of item.tags) {
      if (!seen.has(lower(tag))) seen.set(lower(tag), tag);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** The kinds' names, plural, for the chips. */
export const KIND_LABELS: Record<AllKind, string> = {
  task: 'Tasks',
  note: 'Notes',
  meeting: 'Meetings',
  project: 'Projects',
  person: 'People',
};

/* ---------- the rooms list ---------- */

/**
 * All's rooms list, the Rooms chip beside the kinds: `/all?show=rooms`.
 * It is not a kind, since it lists rooms, not items: no filter, sort,
 * layout or saved view applies, and picking a kind leaves it (every other
 * address All writes drops `show`).
 */
export const ALL_ROOMS_QUERY = 'show=rooms';

/** Whether All's query shows the rooms list in place of the items. */
export function showsRooms(params: URLSearchParams): boolean {
  return params.get('show') === 'rooms';
}

/* ---------- saved views (#338) ---------- */

/**
 * The address a view saves for `filters`: the kinds first, then the
 * filters, sort and layout, defaults left out. Find's words are not kept
 * (search text is never saved), nor a linked note.
 */
export function viewQuery(filters: AllFilters): string {
  const params = new URLSearchParams();
  if (filters.kinds.length > 0) params.set('kind', filters.kinds.join(','));
  for (const [key, v] of Object.entries(allQuery({ ...filters, q: '' }))) {
    if (v) params.set(key, v);
  }
  // Commas stay commas, as the router writes them.
  return params.toString().replaceAll('%2C', ',');
}

/** A saved query as All reads it, written the one way (`viewQuery`). */
export function normalViewQuery(query: string): string {
  return viewQuery(parseAllQuery(new URLSearchParams(query)));
}

/** Where a saved view goes: All with its kinds, and the rest as its query. */
export function viewRoute(query: string): { route: Route; query: string } {
  const params = new URLSearchParams(query);
  const kinds = kindsOf(params.get('kind'));
  params.delete('kind');
  return {
    route: kinds.length > 0 ? { name: 'all', kinds } : { name: 'all' },
    query: params.toString(),
  };
}

/**
 * The view `filters` show, if one is saved: the same address, with the
 * layout shown (`layout`) standing in for an address that names none.
 */
export function currentView(
  views: readonly SavedView[],
  filters: AllFilters,
  layout: string,
): SavedView | undefined {
  const here = viewQuery({ ...filters, view: layoutOrNone(filters, layout) });
  return views.find((v) => {
    const there = parseAllQuery(new URLSearchParams(v.query));
    return (
      viewQuery({
        ...there,
        view: layoutOrNone(there, there.view || 'list'),
      }) === here
    );
  });
}

/** `layout` as an address names it: nothing for a kind with no layouts. */
function layoutOrNone(filters: Pick<AllFilters, 'kinds'>, layout: string) {
  return layoutsFor(filters.kinds).length > 0 ? layout : '';
}

/** The views with `view` added at the end. */
export function addView(
  views: readonly SavedView[],
  view: SavedView,
): SavedView[] {
  return [...views.filter((v) => v.id !== view.id), view];
}

/** The views with `id` renamed. */
export function renameView(
  views: readonly SavedView[],
  id: string,
  name: string,
): SavedView[] {
  return views.map((v) => (v.id === id ? { ...v, name } : v));
}

/** The views without `id`. */
export function removeView(
  views: readonly SavedView[],
  id: string,
): SavedView[] {
  return views.filter((v) => v.id !== id);
}

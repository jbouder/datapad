import { GENERAL_BOARD } from './types';

/**
 * The app's addresses, as pure functions: what an address means, the
 * address for a route, the old addresses that settle on new ones, the
 * rail's place and the title. `src/lib/router.ts` holds the history and
 * React halves.
 *
 * v2 (#329) has three places and the rooms: Today (`/`), Unfiled
 * (`/unfiled`), All (`/all`, `?kind=` picks kinds), a project's room
 * (`/projects/:id`), a person's room (`/people/:id`) and a meeting
 * (`/meetings/:id`). Every address from before lands on its new home
 * (`landRoute`).
 */

/**
 * The kinds All lists (`/all?kind=`, #337), in their order: one or
 * several, comma separated; none is every kind.
 */
export const ALL_KINDS = [
  'task',
  'note',
  'meeting',
  'project',
  'person',
] as const;
export type AllKind = (typeof ALL_KINDS)[number];

export type Route =
  | { name: 'today' }
  /** Lines with no home yet (#333); replaces the Notepad. */
  | { name: 'unfiled' }
  /**
   * Every item of every kind (#337), or of the `kinds` given. Its filters
   * and sort are the rest of the query (`shared/all.ts`).
   */
  | { name: 'all'; kinds?: readonly AllKind[] }
  /** A project's room (#334). */
  | { name: 'project'; id: string }
  /** A person's room (#335). */
  | { name: 'person'; id: string }
  /** One meeting (`/meetings/:id`); meeting mode (#336). */
  | { name: 'meeting'; id: string }
  /**
   * `/tasks/:id`, from before v2: on its way to the task's room with its
   * panel open. Needs the data to know the room, so the shell settles it.
   */
  | { name: 'task'; id: string }
  /**
   * A whiteboard: a project's (`/projects/:id/whiteboard`) or, without
   * `project`, the space's own (`/whiteboard`).
   */
  | { name: 'whiteboard'; project?: string }
  /** Settings → People. */
  | { name: 'people' }
  /** Settings → Orgs; `org` is the one open (`/settings/orgs/:id`). */
  | { name: 'orgs'; org?: string }
  | { name: 'settings'; section: SettingsSection }
  | { name: 'help'; section?: string }
  /** Every shared input, for eyeballing (dev and e2e builds only). */
  | { name: 'devComponents' }
  | { name: 'notFound' };

export type RouteName = Route['name'];

/**
 * The Settings page's sections, each its own address. People and Orgs are
 * routes of their own (`people`, `orgs`) that render as Settings sections.
 */
export const SETTINGS_SECTIONS = [
  'appearance',
  /** Today's options and meeting mode's (#343): Focus's page settings. */
  'today',
  /** The pinned rooms (#329) and the rooms' options (#343). */
  'rooms',
  /** What the capture line saves (#343). */
  'capture',
  /** All's opening kinds, layouts, sorts and saved views (#343). */
  'all',
  'templates',
  'summaries',
  'spaces',
  'people',
  'orgs',
  'data',
  /** The MCP clients the owner approved, with Revoke (#154). */
  'connections',
  'account',
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** `/decisions` and anything under it: retired (#183), now Today. */
const DECISIONS = /^\/decisions(?:\/.*)?$/;

/** The kind each old list page shows in All. */
const OLD_LISTS: Record<string, AllKind> = {
  '/projects': 'project',
  '/archive': 'project',
  '/tasks': 'task',
  '/notes': 'note',
  '/meetings': 'meeting',
  '/events': 'meeting',
};

function trim(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
}

function decoded(value: string): string {
  return decodeURIComponent(value);
}

/**
 * `?a=b`, or empty for no parameters. Commas stay commas, so All's kinds
 * read `kind=task,note`.
 */
function asSearch(params: URLSearchParams): string {
  const text = params.toString().replaceAll('%2C', ',');
  return text ? `?${text}` : '';
}

/**
 * The kinds a `kind` parameter names, each once, in `ALL_KINDS` order;
 * empty (every kind) when it names none.
 */
export function kindsOf(value: string | null): AllKind[] {
  const named = new Set((value ?? '').split(','));
  return ALL_KINDS.filter((kind) => named.has(kind));
}

/**
 * The query a route carries itself: All's `kind`. Every other route has
 * none.
 */
export function routeQuery(route: Route): URLSearchParams {
  const params = new URLSearchParams();
  if (route.name === 'all') {
    const kinds = kindsOf((route.kinds ?? []).join(','));
    if (kinds.length > 0) params.set('kind', kinds.join(','));
  }
  return params;
}

/**
 * A route's query with `extra` after it: the route's own keys first, and
 * they win over the same keys in `extra`.
 */
export function routeSearch(route: Route, extra = ''): string {
  const params = routeQuery(route);
  const own = new Set(params.keys());
  for (const [key, value] of new URLSearchParams(extra)) {
    if (!own.has(key)) params.append(key, value);
  }
  return asSearch(params);
}

/** All, as the query names it: its kinds. */
function allFrom(params: URLSearchParams): Route {
  const kinds = kindsOf(params.get('kind'));
  return kinds.length > 0 ? { name: 'all', kinds } : { name: 'all' };
}

/** All with `kind` and `params`: its address, its own query first. */
function landAll(kind: AllKind, params: URLSearchParams): [Route, string] {
  const route: Route = { name: 'all', kinds: [kind] };
  return [route, routeSearch(route, params.toString())];
}

/**
 * An old list page's query as All reads it (#337): Tasks' Blocked is
 * Waiting on, its assignee is Person (Mine is `me`, Unassigned goes),
 * Notes' and Meetings' project is Room, Projects' Active and Paused are
 * Open; Find, Status (Done, All), Sort and Direction carry over, and the
 * rest (layouts, grouping, Health, Org, Pinned) goes.
 */
function oldListQuery(
  kind: AllKind,
  params: URLSearchParams,
  archived: boolean,
): URLSearchParams {
  const out = new URLSearchParams();
  const q = params.get('q');
  if (q) out.set('q', q);
  const status = params.get('status');
  if (archived) out.set('status', 'archived');
  else if (status === 'done' || status === 'all') out.set('status', status);
  else if (status === 'blocked' && kind === 'task') out.set('waiting', '1');
  const who = params.get('who');
  if (who === 'mine') out.set('person', 'me');
  else if (who?.startsWith('p:') && who.length > 2) {
    out.set('person', who.slice(2));
  }
  const project = params.get('project');
  if (project && project !== 'all') out.set('room', project);
  // `note` opens one note (`?note=<id>`).
  for (const key of ['sort', 'dir', 'note']) {
    const value = params.get(key);
    if (value) out.set(key, value);
  }
  return out;
}

/**
 * Where an address lands, query and all. An old address settles on its
 * new home:
 *
 * - `/focus` and `/decisions…` are Today (`/`); `/digest` is its week
 *   zoom (`/?view=week`)
 * - `/notepad` (and Notes' old Notepad layout) is `/unfiled`
 * - `/projects`, `/tasks`, `/notes`, `/meetings` (and `/events`) are All
 *   with that kind, their filters as All reads them (`oldListQuery`);
 *   `/archive` is All's projects with `status=archived`, as is
 *   `/all?archived=1` (#329's address for it)
 * - `/lists` and `/lists/:id` are All's notes (#328 made lists notes)
 * - `/meetings?meeting=<id>` and `/events?event=<id>` are that meeting
 * - `/settings/people/:id` is the person's room (`/people/:id`)
 * - `/settings/navigation` is Settings → Rooms, `/settings/pages`
 *   Settings → Today
 *
 * `/tasks/:id` is the `task` route: the shell sends it to the task's room
 * once it has the data. `devRoutes` admits `/dev/components` (dev and e2e
 * builds only).
 */
export function landRoute(
  pathname: string,
  search: string,
  hash = '',
  devRoutes = false,
): [Route, string] {
  const clean = trim(pathname);
  const params = new URLSearchParams(search);

  if (clean === '/' || clean === '/focus') return [{ name: 'today' }, search];
  // The Weekly digest is Today's week zoom (#332).
  if (clean === '/digest') return [{ name: 'today' }, '?view=week'];
  if (DECISIONS.test(clean)) return [{ name: 'today' }, ''];
  if (clean === '/notepad') return [{ name: 'unfiled' }, ''];
  if (clean === '/unfiled') return [{ name: 'unfiled' }, search];
  if (clean === '/all') {
    const route = allFrom(params);
    if (params.get('archived') === '1') {
      params.delete('archived');
      params.set('status', 'archived');
    }
    return [route, routeSearch(route, params.toString())];
  }

  // The old list pages: All, narrowed to their kind.
  const kind = OLD_LISTS[clean];
  if (kind) {
    if (clean === '/notes' && params.get('view') === 'notepad') {
      return [{ name: 'unfiled' }, ''];
    }
    // An old link to one meeting opens it.
    const meeting =
      clean === '/events'
        ? (params.get('event') ?? params.get('meeting'))
        : clean === '/meetings'
          ? params.get('meeting')
          : null;
    if (meeting) return [{ name: 'meeting', id: meeting }, ''];
    return landAll(kind, oldListQuery(kind, params, clean === '/archive'));
  }
  if (/^\/lists(?:\/[^/]+)?$/.test(clean)) {
    return landAll('note', new URLSearchParams());
  }

  // A person's room; their old address under Settings gets there too.
  const person = /^(?:\/settings)?\/people\/([^/]+)$/.exec(clean);
  if (person?.[1]) return [{ name: 'person', id: decoded(person[1]) }, search];
  // People and orgs are under Settings (#159); /people and /orgs, their
  // addresses from #93 until then, still get there.
  if (clean === '/people' || clean === '/settings/people') {
    return [{ name: 'people' }, search];
  }
  const orgs = /^(?:\/settings)?\/orgs(?:\/([^/]+))?$/.exec(clean);
  if (orgs) {
    return [
      orgs[1] ? { name: 'orgs', org: decoded(orgs[1]) } : { name: 'orgs' },
      search,
    ];
  }
  if (clean === '/settings/navigation') {
    return [{ name: 'settings', section: 'rooms' }, ''];
  }
  // Settings → Pages went with v2 (#343): Today's options lead.
  if (clean === '/settings/pages') {
    return [{ name: 'settings', section: 'today' }, ''];
  }
  const settings = /^\/settings(?:\/([a-z]+))?$/.exec(clean);
  if (settings) {
    const section = (settings[1] ?? 'appearance') as SettingsSection;
    return [
      SETTINGS_SECTIONS.includes(section)
        ? { name: 'settings', section }
        : { name: 'notFound' },
      search,
    ];
  }
  if (clean === '/help') {
    const section = decoded(hash.replace(/^#/, ''));
    return [section ? { name: 'help', section } : { name: 'help' }, search];
  }
  if (devRoutes && clean === '/dev/components') {
    return [{ name: 'devComponents' }, search];
  }
  if (clean === '/whiteboard') return [{ name: 'whiteboard' }, search];
  const board = /^\/projects\/([^/]+)\/whiteboard$/.exec(clean);
  if (board?.[1]) {
    return [{ name: 'whiteboard', project: decoded(board[1]) }, search];
  }
  const project = /^\/projects\/([^/]+)$/.exec(clean);
  if (project?.[1]) {
    return [{ name: 'project', id: decoded(project[1]) }, search];
  }
  const task = /^\/tasks\/([^/]+)$/.exec(clean);
  if (task?.[1]) return [{ name: 'task', id: decoded(task[1]) }, ''];
  const meeting = /^\/meetings\/([^/]+)$/.exec(clean);
  if (meeting?.[1]) {
    return [{ name: 'meeting', id: decoded(meeting[1]) }, search];
  }
  return [{ name: 'notFound' }, search];
}

/**
 * What `pathname` (and, for Help, `hash`) means, without a query: where
 * `landRoute` puts it.
 */
export function parseRoute(
  pathname: string,
  hash = '',
  devRoutes = false,
  search = '',
): Route {
  return landRoute(pathname, search, hash, devRoutes)[0];
}

/**
 * The path for `route`, without its query (`routeSearch` has that);
 * `null` for Not found, which keeps its own.
 */
export function routePath(route: Route): string | null {
  switch (route.name) {
    case 'today':
      return '/';
    case 'person':
      return `/people/${encodeURIComponent(route.id)}`;
    case 'people':
      return '/settings/people';
    case 'orgs':
      return route.org
        ? `/settings/orgs/${encodeURIComponent(route.org)}`
        : '/settings/orgs';
    case 'settings':
      return route.section === 'appearance'
        ? '/settings'
        : `/settings/${route.section}`;
    case 'project':
      return `/projects/${encodeURIComponent(route.id)}`;
    case 'whiteboard':
      return route.project
        ? `/projects/${encodeURIComponent(route.project)}/whiteboard`
        : '/whiteboard';
    case 'task':
      return `/tasks/${encodeURIComponent(route.id)}`;
    case 'meeting':
      return `/meetings/${encodeURIComponent(route.id)}`;
    case 'help':
      return route.section
        ? `/help#${encodeURIComponent(route.section)}`
        : '/help';
    case 'devComponents':
      return '/dev/components';
    case 'notFound':
      return null;
    default:
      return `/${route.name}`;
  }
}

/** The address of `route`, its own query first, then `extra`. */
export function routeHref(route: Route, extra = ''): string | null {
  const path = routePath(route);
  if (path === null) return null;
  const hash = path.indexOf('#');
  const bare = hash === -1 ? path : path.slice(0, hash);
  const tail = hash === -1 ? '' : path.slice(hash);
  return bare + routeSearch(route, extra) + tail;
}

/**
 * The room a task opens in (`/tasks/:id` from before v2): its project's,
 * or Today for a General task. Its panel opens over it.
 */
export function taskRoom(task: { projectId: string | null }): Route {
  return task.projectId
    ? { name: 'project', id: task.projectId }
    : { name: 'today' };
}

/**
 * The query key that opens a whiteboard on one item (`?item=<id>`): the
 * board selects it and centers the view on it, then drops the key.
 */
export const BOARD_ITEM_PARAM = 'item';

/** The whiteboard a board id names: a project's, or the space's own. */
export function boardRoute(boardId: string): Route {
  return boardId === GENERAL_BOARD
    ? { name: 'whiteboard' }
    : { name: 'whiteboard', project: boardId };
}

/** The address of one whiteboard item (⌘K): its board, and the item. */
export function boardItemLink(
  boardId: string,
  itemId: string,
): { route: Route; query: string } {
  return {
    route: boardRoute(boardId),
    query: new URLSearchParams({ [BOARD_ITEM_PARAM]: itemId }).toString(),
  };
}

/** The rail's and tab bar's places. */
export type Place = 'today' | 'unfiled' | 'all';

/**
 * Which of the three places a route is in, for `aria-current`: the
 * space's whiteboard is reached from All. A room, a meeting, Settings and
 * Help are in none.
 */
export function placeOf(route: Route): Place | null {
  if (route.name === 'today' || route.name === 'unfiled') return route.name;
  if (route.name === 'all') return 'all';
  if (route.name === 'whiteboard' && !route.project) return 'all';
  return null;
}

/** The Settings section a route shows; `null` off the Settings page. */
export function settingsSectionOf(route: Route): SettingsSection | null {
  if (route.name === 'settings') return route.section;
  if (route.name === 'people' || route.name === 'orgs') return route.name;
  return null;
}

/** The route for a Settings section: People and Orgs have their own. */
export function settingsRoute(section: SettingsSection): Route {
  return section === 'people' || section === 'orgs'
    ? { name: section }
    : { name: 'settings', section };
}

const TITLES: Partial<Record<RouteName, string>> = {
  today: 'Today',
  unfiled: 'Unfiled',
  all: 'All',
  whiteboard: 'Whiteboard',
  people: 'People',
  orgs: 'Orgs',
  settings: 'Settings',
  help: 'Help',
  devComponents: 'Components',
  notFound: 'Not found',
};

/**
 * The top bar's title; a room, a meeting or a task passes its name.
 */
export function titleOf(route: Route, name?: string): string {
  if (route.name === 'project') return name ?? 'Project';
  if (route.name === 'person') return name ?? 'Person';
  if (route.name === 'task') return name ?? 'Task';
  if (route.name === 'meeting') return name ?? 'Meeting';
  return TITLES[route.name] ?? 'Datapad';
}

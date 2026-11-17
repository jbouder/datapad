import { GENERAL_BOARD } from './types';

/**
 * The app's addresses, as pure functions: what an address means, the
 * address for a route, the old addresses that settle on new ones, the
 * rail's place and the title. `src/lib/router.ts` holds the history and
 * React halves.
 *
 * v2 (#329) has three places and the rooms: Today (`/`), Unfiled
 * (`/unfiled`), All (`/all`, `?kind=` picks one kind), a project's room
 * (`/projects/:id`), a person's room (`/people/:id`) and a meeting
 * (`/meetings/:id`). Every address from before lands on its new home
 * (`landRoute`).
 */

/** The kinds All can be narrowed to (`/all?kind=`). */
export const ALL_KINDS = ['project', 'task', 'note', 'meeting'] as const;
export type AllKind = (typeof ALL_KINDS)[number];

export function isAllKind(value: unknown): value is AllKind {
  return (ALL_KINDS as readonly unknown[]).includes(value);
}

export type Route =
  | { name: 'today' }
  /** Lines with no home yet (#333); replaces the Notepad. */
  | { name: 'unfiled' }
  /**
   * Every item of every kind (#337), or one kind. `archived` is the
   * archived projects, with `kind: 'project'`.
   */
  | { name: 'all'; kind?: AllKind; archived?: true }
  /**
   * A project's room (#334): the Stream tab, or with `tab` the Plan tab
   * (`/projects/:id/plan`). Its Whiteboard tab is the project's
   * `whiteboard` route.
   */
  | { name: 'project'; id: string; tab?: 'plan' }
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
   * A whiteboard: a project's (`/projects/:id/whiteboard`, its room's
   * Whiteboard tab) or, without `project`, the space's own (`/whiteboard`).
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
  /** Each page's saved layout, sorts, filters and sections (#186). */
  'pages',
  /** The pinned rooms, in the rail's order (#329). */
  'rooms',
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

/** `?a=b`, or empty for no parameters. */
function asSearch(params: URLSearchParams): string {
  const text = params.toString();
  return text ? `?${text}` : '';
}

/**
 * The query a route carries itself: All's `kind` and `archived`. Every
 * other route has none.
 */
export function routeQuery(route: Route): URLSearchParams {
  const params = new URLSearchParams();
  if (route.name === 'all') {
    if (route.kind) params.set('kind', route.kind);
    if (route.archived) params.set('archived', '1');
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

/** All, as the query names it: the kind, and archived projects. */
function allFrom(params: URLSearchParams): Route {
  const kind = params.get('kind');
  if (!isAllKind(kind)) return { name: 'all' };
  return kind === 'project' && params.get('archived') === '1'
    ? { name: 'all', kind, archived: true }
    : { name: 'all', kind };
}

/**
 * Where an address lands, query and all. An old address settles on its
 * new home:
 *
 * - `/focus`, `/digest` and `/decisions…` are Today (`/`)
 * - `/notepad` (and Notes' old Notepad layout) is `/unfiled`
 * - `/projects`, `/tasks`, `/notes`, `/meetings` (and `/events`) are All
 *   with that kind, their filters kept; `/archive` adds `archived=1`
 * - `/lists` and `/lists/:id` are All's notes (#328 made lists notes)
 * - `/meetings?meeting=<id>` and `/events?event=<id>` are that meeting
 * - `/settings/people/:id` is the person's room (`/people/:id`)
 * - `/settings/navigation` is Settings → Rooms
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
  if (clean === '/digest' || DECISIONS.test(clean)) {
    return [{ name: 'today' }, ''];
  }
  if (clean === '/notepad') return [{ name: 'unfiled' }, ''];
  if (clean === '/unfiled') return [{ name: 'unfiled' }, search];
  if (clean === '/all') {
    const route = allFrom(params);
    return [route, routeSearch(route, search)];
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
    params.delete('kind');
    params.delete('archived');
    const route: Route =
      clean === '/archive'
        ? { name: 'all', kind, archived: true }
        : { name: 'all', kind };
    return [route, routeSearch(route, params.toString())];
  }
  if (/^\/lists(?:\/[^/]+)?$/.test(clean)) {
    const route: Route = { name: 'all', kind: 'note' };
    return [route, routeSearch(route)];
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
  const plan = /^\/projects\/([^/]+)\/plan$/.exec(clean);
  if (plan?.[1]) {
    return [{ name: 'project', id: decoded(plan[1]), tab: 'plan' }, search];
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
      return `/projects/${encodeURIComponent(route.id)}${route.tab ? `/${route.tab}` : ''}`;
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

/** A project room's tabs (#334), in order. */
export const ROOM_TABS = ['stream', 'plan', 'whiteboard'] as const;
export type RoomTab = (typeof ROOM_TABS)[number];

/**
 * The project room a route shows and its tab: a project's address is its
 * Stream or Plan, a project's whiteboard its Whiteboard tab. Null for
 * any other route (the space's own whiteboard among them).
 */
export function projectRoomOf(
  route: Route,
): { id: string; tab: RoomTab } | null {
  if (route.name === 'project') {
    return { id: route.id, tab: route.tab ?? 'stream' };
  }
  if (route.name === 'whiteboard' && route.project) {
    return { id: route.project, tab: 'whiteboard' };
  }
  return null;
}

/** The address of one tab of a project's room. */
export function roomTabRoute(id: string, tab: RoomTab): Route {
  if (tab === 'whiteboard') return { name: 'whiteboard', project: id };
  return tab === 'plan'
    ? { name: 'project', id, tab }
    : { name: 'project', id };
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

/** All's title for one kind. */
const KIND_TITLES: Record<AllKind, string> = {
  project: 'Projects',
  task: 'Tasks',
  note: 'Notes',
  meeting: 'Meetings',
};

/**
 * The top bar's title; a room, a meeting or a task passes its name.
 */
export function titleOf(route: Route, name?: string): string {
  if (route.name === 'project') return name ?? 'Project';
  if (route.name === 'person') return name ?? 'Person';
  if (route.name === 'task') return name ?? 'Task';
  if (route.name === 'meeting') return name ?? 'Meeting';
  if (route.name === 'all' && route.kind) {
    return route.archived ? 'Archived' : KIND_TITLES[route.kind];
  }
  return TITLES[route.name] ?? 'Datapad';
}

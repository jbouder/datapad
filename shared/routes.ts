import { GENERAL_BOARD } from './types';

/**
 * The app's addresses, as pure functions: what a path means, the path for
 * a route, the old addresses that settle on new ones, the nav section and
 * the title. `src/lib/router.ts` holds the history and React halves.
 */

export type Route =
  | { name: 'focus' }
  | { name: 'projects' }
  | { name: 'archive' }
  | { name: 'project'; id: string }
  | { name: 'tasks' }
  /** One task's page (`/tasks/:id`), opened from Tasks. */
  | { name: 'task'; id: string }
  | { name: 'notes' }
  | { name: 'meetings' }
  /** One meeting's page (`/meetings/:id`). */
  | { name: 'meeting'; id: string }
  | { name: 'digest' }
  /**
   * A whiteboard: a project's (`/projects/:id/whiteboard`) or, without
   * `project`, the space's own (`/whiteboard`).
   */
  | { name: 'whiteboard'; project?: string }
  /** Settings → People; `person` is the one selected (`/settings/people/:id`). */
  | { name: 'people'; person?: string }
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
  'navigation',
  'templates',
  'summaries',
  'spaces',
  'people',
  'orgs',
  'data',
  'account',
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** `/decisions` and anything under it: retired (#183), now Focus. */
const DECISIONS = /^\/decisions(?:\/.*)?$/;

const SIMPLE = new Set<RouteName>([
  'projects',
  'archive',
  'tasks',
  'notes',
  'meetings',
  'digest',
  'whiteboard',
]);

/**
 * What `pathname` (and, for Help, `hash`) means. `devRoutes` admits
 * `/dev/components` (dev and e2e builds only).
 */
export function parseRoute(
  pathname: string,
  hash = '',
  devRoutes = false,
): Route {
  const clean = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  if (clean === '/' || clean === '/focus') {
    return { name: 'focus' };
  }
  // Decisions were retired in #183 (their data is kept); their addresses
  // land on Focus.
  if (DECISIONS.test(clean)) {
    return { name: 'focus' };
  }
  // Events became meetings in #131; the old address still gets there.
  if (clean === '/events') {
    return { name: 'meetings' };
  }
  // People and orgs are under Settings (#159); /people and /orgs, their
  // addresses from #93 until then, still get there.
  const people = /^(?:\/settings)?\/people(?:\/([^/]+))?$/.exec(clean);
  if (people) {
    return people[1]
      ? { name: 'people', person: decodeURIComponent(people[1]) }
      : { name: 'people' };
  }
  const orgs = /^(?:\/settings)?\/orgs(?:\/([^/]+))?$/.exec(clean);
  if (orgs) {
    return orgs[1]
      ? { name: 'orgs', org: decodeURIComponent(orgs[1]) }
      : { name: 'orgs' };
  }
  const settings = /^\/settings(?:\/([a-z]+))?$/.exec(clean);
  if (settings) {
    const section = (settings[1] ?? 'appearance') as SettingsSection;
    return SETTINGS_SECTIONS.includes(section)
      ? { name: 'settings', section }
      : { name: 'notFound' };
  }
  if (clean === '/help') {
    const section = decodeURIComponent(hash.replace(/^#/, ''));
    return section ? { name: 'help', section } : { name: 'help' };
  }
  if (devRoutes && clean === '/dev/components') {
    return { name: 'devComponents' };
  }
  const board = /^\/projects\/([^/]+)\/whiteboard$/.exec(clean);
  if (board?.[1]) {
    return { name: 'whiteboard', project: decodeURIComponent(board[1]) };
  }
  const project = /^\/projects\/([^/]+)$/.exec(clean);
  if (project?.[1]) {
    return { name: 'project', id: decodeURIComponent(project[1]) };
  }
  const task = /^\/tasks\/([^/]+)$/.exec(clean);
  if (task?.[1]) {
    return { name: 'task', id: decodeURIComponent(task[1]) };
  }
  const meeting = /^\/meetings\/([^/]+)$/.exec(clean);
  if (meeting?.[1]) {
    return { name: 'meeting', id: decodeURIComponent(meeting[1]) };
  }
  const name = clean.slice(1) as RouteName;
  if (SIMPLE.has(name)) {
    return { name } as Route;
  }
  return { name: 'notFound' };
}

/** The path for `route`; `null` for Not found, which keeps its own. */
export function routePath(route: Route): string | null {
  switch (route.name) {
    case 'focus':
      return '/';
    case 'people':
      return route.person
        ? `/settings/people/${encodeURIComponent(route.person)}`
        : '/settings/people';
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

/**
 * The query an old address carries over to its new one: `/events?event=<id>`
 * opened that event, and `/meetings?meeting=<id>` opens the meeting. A
 * retired `/decisions` address keeps none of its query on Focus.
 * Everything else in the query is kept as it was.
 */
export function canonicalQuery(pathname: string, search: string): string {
  const clean = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  if (DECISIONS.test(clean)) return '';
  if (clean !== '/events') return search;
  const params = new URLSearchParams(search);
  const id = params.get('event');
  if (id === null) return search;
  params.delete('event');
  if (!params.has('meeting')) params.set('meeting', id);
  return `?${params.toString()}`;
}

/**
 * The meeting an old link opens: `/meetings?meeting=<id>` (and so
 * `/events?event=<id>`) went to its row until meetings had a page of their
 * own; now it is that page. `null` for any other address.
 */
export function linkedMeeting(pathname: string, search: string): string | null {
  const route = parseRoute(pathname);
  if (route.name !== 'meetings') return null;
  return new URLSearchParams(canonicalQuery(pathname, search)).get('meeting');
}

/**
 * The query key that opens a whiteboard on one item (`?item=<id>`): the
 * board selects it and centres the view on it, then drops the key.
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

/** The top-level section a route belongs to, for `aria-current` in the nav. */
export function sectionOf(route: Route): RouteName {
  if (route.name === 'project' || route.name === 'archive') return 'projects';
  // A project's board is part of the project; the space's has the rail.
  if (route.name === 'whiteboard' && route.project) return 'projects';
  if (route.name === 'task') return 'tasks';
  if (route.name === 'meeting') return 'meetings';
  if (route.name === 'people' || route.name === 'orgs') return 'settings';
  return route.name;
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
  focus: 'Focus',
  projects: 'Projects',
  archive: 'Archived',
  tasks: 'Tasks',
  notes: 'Notes',
  meetings: 'Meetings',
  digest: 'Weekly digest',
  whiteboard: 'Whiteboard',
  people: 'People',
  orgs: 'Orgs',
  settings: 'Settings',
  help: 'Help',
  devComponents: 'Components',
  notFound: 'Not found',
};

/** The top bar's title; a project, task or meeting page passes its name. */
export function titleOf(route: Route, name?: string): string {
  if (route.name === 'project') return name ?? 'Project';
  if (route.name === 'task') return name ?? 'Task';
  if (route.name === 'meeting') return name ?? 'Meeting';
  return TITLES[route.name] ?? 'Datapad';
}

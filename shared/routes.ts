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
  | { name: 'notes' }
  | { name: 'meetings' }
  | { name: 'decisions' }
  | { name: 'digest' }
  /** `person` is the one selected (`/people/:id`). */
  | { name: 'people'; person?: string }
  /** `org` is the one open (`/orgs/:id`). */
  | { name: 'orgs'; org?: string }
  | { name: 'settings'; section: SettingsSection }
  | { name: 'help'; section?: string }
  /** Every shared input, for eyeballing (dev and e2e builds only). */
  | { name: 'devComponents' }
  | { name: 'notFound' };

export type RouteName = Route['name'];

/** The Settings page's sections, each its own address. */
export const SETTINGS_SECTIONS = [
  'appearance',
  'templates',
  'summaries',
  'spaces',
  'data',
  'account',
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

const SIMPLE = new Set<RouteName>([
  'projects',
  'archive',
  'tasks',
  'notes',
  'meetings',
  'decisions',
  'digest',
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
  // Events became meetings in #131; the old address still gets there.
  if (clean === '/events') {
    return { name: 'meetings' };
  }
  // People and orgs lived under Settings until #93; the old addresses
  // still get there.
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
  const project = /^\/projects\/([^/]+)$/.exec(clean);
  if (project?.[1]) {
    return { name: 'project', id: decodeURIComponent(project[1]) };
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
        ? `/people/${encodeURIComponent(route.person)}`
        : '/people';
    case 'orgs':
      return route.org ? `/orgs/${encodeURIComponent(route.org)}` : '/orgs';
    case 'settings':
      return route.section === 'appearance'
        ? '/settings'
        : `/settings/${route.section}`;
    case 'project':
      return `/projects/${encodeURIComponent(route.id)}`;
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
 * opened that event, and `/meetings?meeting=<id>` opens the meeting.
 * Everything else in the query is kept as it was.
 */
export function canonicalQuery(pathname: string, search: string): string {
  const clean = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  if (clean !== '/events') return search;
  const params = new URLSearchParams(search);
  const id = params.get('event');
  if (id === null) return search;
  params.delete('event');
  if (!params.has('meeting')) params.set('meeting', id);
  return `?${params.toString()}`;
}

/** The top-level section a route belongs to, for `aria-current` in the nav. */
export function sectionOf(route: Route): RouteName {
  return route.name === 'project' || route.name === 'archive'
    ? 'projects'
    : route.name;
}

const TITLES: Partial<Record<RouteName, string>> = {
  focus: 'Focus',
  projects: 'Projects',
  archive: 'Archived',
  tasks: 'Tasks',
  notes: 'Notes',
  meetings: 'Meetings',
  decisions: 'Decisions',
  digest: 'Weekly digest',
  people: 'People',
  orgs: 'Orgs',
  settings: 'Settings',
  help: 'Help',
  devComponents: 'Components',
  notFound: 'Not found',
};

/** The top bar's title; a project page passes its name. */
export function titleOf(route: Route, projectName?: string): string {
  if (route.name === 'project') return projectName ?? 'Project';
  return TITLES[route.name] ?? 'Datapad';
}

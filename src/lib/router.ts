import { useSyncExternalStore } from 'react';

/**
 * A small `history.pushState` router, holocron's. Route changes go through
 * `runTransition`, which the app shell points at `withViewTransition` so
 * navigation animates as a page transition. Path routing, not hash routing:
 * deep links survive the Cloudflare Access login round trip.
 *
 * The query string is separate state (`useQuery` / `setQuery`): filters,
 * sorts and layouts live there so the back button restores them, and
 * changing one is not a page change.
 */

export type Route =
  | { name: 'focus' }
  | { name: 'projects' }
  | { name: 'archive' }
  | { name: 'project'; id: string }
  | { name: 'tasks' }
  | { name: 'notes' }
  | { name: 'events' }
  | { name: 'people' }
  | { name: 'help'; section?: string }
  | { name: 'notFound' };

export type RouteName = Route['name'];

const SIMPLE = new Set<RouteName>([
  'projects',
  'archive',
  'tasks',
  'notes',
  'events',
  'people',
]);

export function parse(pathname: string, hash = ''): Route {
  const clean = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  if (clean === '/' || clean === '/focus') {
    return { name: 'focus' };
  }
  if (clean === '/help') {
    const section = decodeURIComponent(hash.replace(/^#/, ''));
    return section ? { name: 'help', section } : { name: 'help' };
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

export function pathFor(route: Route): string {
  switch (route.name) {
    case 'focus':
      return '/focus';
    case 'project':
      return `/projects/${encodeURIComponent(route.id)}`;
    case 'help':
      return route.section
        ? `/help#${encodeURIComponent(route.section)}`
        : '/help';
    case 'notFound':
      return window.location.pathname;
    default:
      return `/${route.name}`;
  }
}

/** Two routes are the same page (same name, same project). */
export function samePage(a: Route, b: Route): boolean {
  return (
    a.name === b.name &&
    (a.name !== 'project' || a.id === (b as { id: string }).id)
  );
}

function here(): string {
  return (
    window.location.pathname + window.location.search + window.location.hash
  );
}

// `/` is Focus; say so in the address bar too.
if (window.location.pathname === '/') {
  window.history.replaceState(
    null,
    '',
    `/focus${window.location.search}${window.location.hash}`,
  );
}

let current: Route = parse(window.location.pathname, window.location.hash);
let search = window.location.search;
const listeners = new Set<() => void>();

type Transition = (update: () => void) => void;
let runTransition: Transition = (update) => update();

/** The app shell installs the view-transition wrapper here. */
export function setRouteTransition(transition: Transition) {
  runTransition = transition;
}

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

function commit(next: Route, nextSearch: string) {
  const update = () => {
    current = next;
    search = nextSearch;
    notify();
  };
  // Same page (a help section, a query change): no page transition.
  if (samePage(next, current)) {
    update();
    return;
  }
  runTransition(update);
}

export function navigate(
  route: Route,
  options: { replace?: boolean; query?: string } = {},
) {
  const query = options.query ? `?${options.query.replace(/^\?/, '')}` : '';
  const path = pathFor(route) + query;
  if (options.replace) {
    window.history.replaceState(null, '', path);
  } else if (path !== here()) {
    window.history.pushState(null, '', path);
  }
  commit(route, query);
}

window.addEventListener('popstate', () => {
  commit(
    parse(window.location.pathname, window.location.hash),
    window.location.search,
  );
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => current);
}

/** The current query string (`?a=b`, or empty). */
export function useQuery(): URLSearchParams {
  const value = useSyncExternalStore(subscribe, () => search);
  return new URLSearchParams(value);
}

/**
 * Change query parameters on the current page; `null` or `''` removes
 * one. Pushes a history entry so Back restores the previous filters,
 * unless `replace`. `transition` wraps the update (a `filter` view
 * transition, say).
 */
export function setQuery(
  changes: Record<string, string | null>,
  options: { replace?: boolean; transition?: Transition } = {},
) {
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === '') params.delete(key);
    else params.set(key, value);
  }
  const text = params.toString();
  const next = text ? `?${text}` : '';
  if (next === search) return;
  const path = window.location.pathname + next + window.location.hash;
  if (options.replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  const update = () => {
    search = next;
    notify();
  };
  (options.transition ?? ((u: () => void) => u()))(update);
}

/** For real anchors: middle-click and "open in new tab" keep working. */
export function linkProps(route: Route, query?: string) {
  const href = pathFor(route) + (query ? `?${query.replace(/^\?/, '')}` : '');
  return {
    href,
    onClick(event: React.MouseEvent<HTMLAnchorElement>) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      navigate(route, { query });
    },
  };
}

import { useSyncExternalStore } from 'react';
import {
  canonicalQuery,
  linkedMeeting,
  parseRoute,
  type Route,
  routePath,
  settingsSectionOf,
} from '#shared/routes';

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

export {
  type Route,
  type RouteName,
  SETTINGS_SECTIONS,
  type SettingsSection,
  settingsRoute,
  settingsSectionOf,
} from '#shared/routes';

/** `/dev/components` exists in `vite dev` and in the e2e build only. */
export const DEV_ROUTES: boolean = __DEV_ROUTES__;

export function parse(pathname: string, hash = ''): Route {
  return parseRoute(pathname, hash, DEV_ROUTES);
}

export function pathFor(route: Route): string {
  return routePath(route) ?? window.location.pathname;
}

/**
 * Two routes are the same page (same name, same project or meeting). Settings
 * sections, People and Orgs among them, are one page, so moving between
 * them is no page transition; so is picking another person or org.
 */
export function samePage(a: Route, b: Route): boolean {
  if (settingsSectionOf(a) && settingsSectionOf(b)) return true;
  return (
    a.name === b.name &&
    ((a.name !== 'project' && a.name !== 'meeting') ||
      a.id === (b as { id: string }).id)
  );
}

function here(): string {
  return (
    window.location.pathname + window.location.search + window.location.hash
  );
}

/**
 * Where an address lands: the route and its query. Old addresses settle on
 * their canonical one: /focus is /, /people is /settings/people,
 * /events?event=<id> and /meetings?meeting=<id> are /meetings/<id>.
 */
function land(pathname: string, query: string, hash: string): [Route, string] {
  const meeting = linkedMeeting(pathname, query);
  if (meeting) return [{ name: 'meeting', id: meeting }, ''];
  return [parse(pathname, hash), canonicalQuery(pathname, query)];
}

let [current, search] = land(
  window.location.pathname,
  window.location.search,
  window.location.hash,
);
if (
  current.name !== 'notFound' &&
  (pathFor(current) !== window.location.pathname ||
    search !== window.location.search) &&
  current.name !== 'help'
) {
  window.history.replaceState(
    null,
    '',
    pathFor(current) + search + window.location.hash,
  );
}
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

/** The latest commit's number: an older one that lands late is dropped. */
let latest = 0;

function commit(next: Route, nextSearch: string, instant = false) {
  const id = ++latest;
  const update = () => {
    // Back pressed mid-transition: the view transition API can run the
    // earlier update after this one, which would leave the old page up.
    if (id !== latest) return;
    current = next;
    search = nextSearch;
    notify();
  };
  // Same page (a help section, a query change): no page transition.
  if (instant || samePage(next, current)) {
    update();
    return;
  }
  runTransition(update);
}

/** The route right now, outside React (`useRoute` inside it). */
export function currentRoute(): Route {
  return current;
}

/**
 * Go to `route`. `instant` skips the page transition, for a change that
 * already runs inside another one (switching spaces).
 */
export function navigate(
  route: Route,
  options: { replace?: boolean; query?: string; instant?: boolean } = {},
) {
  const query = options.query ? `?${options.query.replace(/^\?/, '')}` : '';
  const path = pathFor(route) + query;
  if (options.replace) {
    window.history.replaceState(null, '', path);
  } else if (path !== here()) {
    window.history.pushState(null, '', path);
  }
  commit(route, query, options.instant);
}

window.addEventListener('popstate', () => {
  const { pathname, search: query, hash } = window.location;
  const [route, nextSearch] = land(pathname, query, hash);
  // An old meeting link in the history: settle it as on load.
  if (route.name === 'meeting' && pathFor(route) !== pathname) {
    window.history.replaceState(null, '', pathFor(route) + hash);
  }
  commit(route, nextSearch);
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

import { useSyncExternalStore } from 'react';
import {
  landRoute,
  projectRoomOf,
  type Route,
  routeHref,
  routePath,
  routeSearch,
  settingsSectionOf,
} from '#shared/routes';
import { holdLeave } from '@/lib/leave';

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
  BOARD_ITEM_PARAM,
  boardItemLink,
  type Route,
  SETTINGS_SECTIONS,
  type SettingsSection,
  settingsRoute,
  settingsSectionOf,
} from '#shared/routes';

/** `/dev/components` exists in `vite dev` and in the e2e build only. */
export const DEV_ROUTES: boolean = __DEV_ROUTES__;

/** Where an address lands (see `landRoute`). */
export function parse(pathname: string, search = '', hash = ''): Route {
  return landRoute(pathname, search, hash, DEV_ROUTES)[0];
}

export function pathFor(route: Route): string {
  return routePath(route) ?? window.location.pathname;
}

/**
 * The address for `route` with `query` after its own (All's `kind`):
 * what links and `navigate` go to.
 */
export function hrefFor(route: Route, query = ''): string {
  return routeHref(route, query) ?? window.location.pathname;
}

/**
 * Two routes are the same page (same name, same project, task, meeting or
 * list). Settings sections, People and Orgs among them, are one page, so
 * moving between them is no page transition; so is picking another person
 * or org, and All is one page whatever its kinds.
 */
export function samePage(a: Route, b: Route): boolean {
  if (settingsSectionOf(a) && settingsSectionOf(b)) return true;
  // A project room's tabs, its whiteboard among them, are one page.
  const roomA = projectRoomOf(a);
  const roomB = projectRoomOf(b);
  if (roomA || roomB) return roomA?.id === roomB?.id;
  if (a.name === 'whiteboard' || b.name === 'whiteboard') {
    return (
      a.name === 'whiteboard' &&
      b.name === 'whiteboard' &&
      a.project === b.project
    );
  }
  return (
    a.name === b.name &&
    ((a.name !== 'project' &&
      a.name !== 'person' &&
      a.name !== 'task' &&
      a.name !== 'meeting') ||
      a.id === (b as { id: string }).id)
  );
}

function here(): string {
  return (
    window.location.pathname + window.location.search + window.location.hash
  );
}

/**
 * Where this tab is in its history, for the top bar's Back and Forward:
 * each entry the app pushes carries its place (`{ i }`), and `last` is
 * the furthest entry Forward can reach. Kept in session storage, so a
 * reload still knows; entries from before the app loaded count as none.
 */
const LAST_KEY = 'datapad:history-last';
let place = indexOf(window.history.state);
// A fresh entry (a typed address, a new tab) has nothing ahead of it.
let last = hasPlace(window.history.state) ? Math.max(place, readLast()) : 0;
writeLast();

function hasPlace(state: unknown): boolean {
  return typeof (state as { i?: unknown } | null)?.i === 'number';
}

function indexOf(state: unknown): number {
  const i = (state as { i?: unknown } | null)?.i;
  return typeof i === 'number' && Number.isInteger(i) && i >= 0 ? i : 0;
}

function readLast(): number {
  try {
    const n = Number(window.sessionStorage.getItem(LAST_KEY));
    return Number.isInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeLast() {
  try {
    window.sessionStorage.setItem(LAST_KEY, String(last));
  } catch {
    // Storage blocked: Forward forgets on reload, nothing else.
  }
}

/** A new entry: one place on, and nothing ahead of it any more. */
function push(path: string) {
  place += 1;
  last = place;
  writeLast();
  window.history.pushState({ i: place }, '', path);
}

/** The same entry at another address, keeping its place. */
function replace(path: string) {
  window.history.replaceState({ i: place }, '', path);
}

/**
 * Where an address lands: the route and its query. Old addresses settle on
 * their new homes (`landRoute`): /focus is /, /tasks is /all?kind=task,
 * /notepad and /unfiled are /scratch, /settings/people/<id> is
 * /people/<id>, …
 */
function land(pathname: string, query: string, hash: string): [Route, string] {
  return landRoute(pathname, query, hash, DEV_ROUTES);
}

/** Put the address an old one settled on in the bar, in place. */
function settle(route: Route, query: string) {
  if (route.name === 'notFound' || route.name === 'help') return;
  const { pathname, search: was, hash } = window.location;
  if (pathFor(route) !== pathname || query !== was) {
    replace(pathFor(route) + query + hash);
  }
}

let [current, search] = land(
  window.location.pathname,
  window.location.search,
  window.location.hash,
);
settle(current, search);
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

/**
 * The last page left that was not a meeting, with its query: where
 * meeting mode's Leave goes back to (#336). Moving through a series
 * keeps it.
 */
let outside: { route: Route; search: string } | null = null;

/**
 * Leave meeting mode: to the page it was entered from, or to Today.
 * `replace` drops the meeting from the history (it was deleted).
 */
export function leaveMeeting(options: { replace?: boolean } = {}) {
  const to = outside ?? { route: { name: 'today' } as Route, search: '' };
  navigate(to.route, { query: to.search, replace: options.replace });
}

/** The latest commit's number: an older one that lands late is dropped. */
let latest = 0;

function commit(next: Route, nextSearch: string, instant = false) {
  const id = ++latest;
  const update = () => {
    // Back pressed mid-transition: the view transition API can run the
    // earlier update after this one, which would leave the old page up.
    if (id !== latest) return;
    if (current.name !== 'meeting' && !samePage(next, current)) {
      outside = { route: current, search };
    }
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
  const path = hrefFor(route, options.query);
  const query = routeSearch(route, options.query);
  // Unsaved work on the page asks first, then finishes the trip.
  if (!samePage(route, current) && holdLeave(() => navigate(route, options)))
    return;
  if (options.replace) {
    replace(path);
  } else if (path !== here()) {
    push(path);
  }
  commit(route, query, options.instant);
}

window.addEventListener('popstate', (event) => {
  place = indexOf(event.state);
  last = Math.max(last, place);
  const { pathname, search: query, hash } = window.location;
  const [route, nextSearch] = land(pathname, query, hash);
  // Back or Forward over unsaved work: stay on this page and ask; going on
  // afterward goes to where the history pointed.
  if (!samePage(route, current)) {
    const target = pathname + query + hash;
    const stay = pathFor(current) + search;
    if (
      holdLeave(() => {
        push(target);
        commit(route, nextSearch);
      })
    ) {
      push(stay);
      notify();
      return;
    }
  }
  // An old address in the history: settle it as on load.
  settle(route, nextSearch);
  commit(route, nextSearch);
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Whether the top bar's Back and Forward have somewhere to go in this
 * tab's history (entries the app made, not pages before it loaded).
 */
export function useHistoryNav(): { back: boolean; forward: boolean } {
  const at = useSyncExternalStore(subscribe, () => `${place}:${last}`);
  const [i, end] = at.split(':').map(Number) as [number, number];
  return { back: i > 0, forward: i < end };
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
  if (options.replace) replace(path);
  else push(path);
  const update = () => {
    search = next;
    notify();
  };
  (options.transition ?? ((u: () => void) => u()))(update);
}

/**
 * Spell out on the current history entry the parameters it lacks, without
 * a re-render (the page already shows them): before a change pushes a new
 * entry, so Back returns to exactly what was on screen (#186).
 */
export function pinQuery(values: Record<string, string>) {
  const params = new URLSearchParams(search);
  let changed = false;
  for (const [key, value] of Object.entries(values)) {
    if (!params.has(key)) {
      params.set(key, value);
      changed = true;
    }
  }
  if (!changed) return;
  search = `?${params.toString()}`;
  replace(window.location.pathname + search + window.location.hash);
}

/** For real anchors: middle-click and "open in new tab" keep working. */
export function linkProps(route: Route, query?: string) {
  const href = hrefFor(route, query);
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

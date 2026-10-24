import { useSyncExternalStore } from 'react';

/**
 * A small `history.pushState` router, holocron's. Route changes go through
 * `runTransition`, which the app shell points at `withViewTransition` so
 * navigation animates as a page transition. Path routing, not hash routing:
 * deep links survive the Cloudflare Access login round trip.
 *
 * M0 has Focus (the home page) and Help; each view adds its route as it
 * lands (Projects, Tasks, Notes, Events, People, …).
 */

export type Route = { name: 'focus' } | { name: 'help'; section?: string };

export function parse(pathname: string, hash = ''): Route {
  const clean = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  if (clean === '/help') {
    const section = decodeURIComponent(hash.replace(/^#/, ''));
    return section ? { name: 'help', section } : { name: 'help' };
  }
  return { name: 'focus' };
}

export function pathFor(route: Route): string {
  switch (route.name) {
    case 'focus':
      return '/';
    case 'help':
      return route.section
        ? `/help#${encodeURIComponent(route.section)}`
        : '/help';
  }
}

function here(): string {
  return window.location.pathname + window.location.hash;
}

let current: Route = parse(window.location.pathname, window.location.hash);
const listeners = new Set<() => void>();

type Transition = (update: () => void) => void;
let runTransition: Transition = (update) => update();

/** The app shell installs the view-transition wrapper here. */
export function setRouteTransition(transition: Transition) {
  runTransition = transition;
}

function commit(next: Route) {
  const update = () => {
    current = next;
    for (const listener of listeners) {
      listener();
    }
  };
  // Moving between sections of the same page is a scroll, not a page change.
  if (next.name === current.name && next.name === 'help') {
    update();
    return;
  }
  runTransition(update);
}

export function navigate(route: Route, options: { replace?: boolean } = {}) {
  const path = pathFor(route);
  if (options.replace) {
    window.history.replaceState(null, '', path);
  } else if (path !== here()) {
    window.history.pushState(null, '', path);
  }
  commit(route);
}

window.addEventListener('popstate', () => {
  commit(parse(window.location.pathname, window.location.hash));
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

/** For real anchors: middle-click and "open in new tab" keep working. */
export function linkProps(route: Route) {
  return {
    href: pathFor(route),
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
      navigate(route);
    },
  };
}

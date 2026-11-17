/**
 * Prototype: its own tiny router under `/v2`, so the app's router and
 * routes stay as they are. Leaving for the classic app is a full load.
 */
import { useSyncExternalStore } from 'react';

export type V2Route =
  | { name: 'today' }
  | { name: 'loose' }
  | { name: 'library' }
  | { name: 'project'; id: string }
  | { name: 'person'; id: string }
  | { name: 'meeting'; id: string };

export function parseV2(pathname: string): V2Route {
  const [, , kind, id] = pathname.replace(/\/$/, '').split('/');
  const key = id ? decodeURIComponent(id) : '';
  if (kind === 'loose') return { name: 'loose' };
  if (kind === 'library') return { name: 'library' };
  if (kind === 'p' && key) return { name: 'project', id: key };
  if (kind === 'person' && key) return { name: 'person', id: key };
  if (kind === 'm' && key) return { name: 'meeting', id: key };
  return { name: 'today' };
}

export function v2Path(route: V2Route): string {
  switch (route.name) {
    case 'today':
      return '/v2';
    case 'loose':
      return '/v2/loose';
    case 'library':
      return '/v2/library';
    case 'project':
      return `/v2/p/${encodeURIComponent(route.id)}`;
    case 'person':
      return `/v2/person/${encodeURIComponent(route.id)}`;
    case 'meeting':
      return `/v2/m/${encodeURIComponent(route.id)}`;
  }
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

export function go(route: V2Route) {
  const path = v2Path(route);
  if (path !== window.location.pathname) {
    window.history.pushState(null, '', path);
    window.scrollTo(0, 0);
  }
  for (const listener of listeners) listener();
}

export function useV2Route(): V2Route {
  const path = useSyncExternalStore(subscribe, () => window.location.pathname);
  return parseV2(path);
}

export function isV2Path(pathname: string): boolean {
  return pathname === '/v2' || pathname.startsWith('/v2/');
}

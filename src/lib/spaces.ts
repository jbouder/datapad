import { MAIN_SPACE } from '#shared/types';

/**
 * The client's side of spaces (M9): which space this device has open is
 * a preference (`datapad:space`), not part of the URL, so links open in
 * whatever space is active.
 */

/** Where this device remembers the open space. */
export const SPACE_KEY = 'datapad:space';

/**
 * A per-space storage key. `main` keeps the keys from before spaces
 * (`datapad:snapshot`, …), so nothing cached or queued is lost; any other
 * space appends its id (`datapad:snapshot:<id>`).
 */
export function keyFor(base: string, space: string): string {
  return space === MAIN_SPACE ? base : `${base}:${space}`;
}

/**
 * Where switching spaces leaves you: a room (a project's or a person's)
 * or an org belongs to the space you are leaving, so its page goes to
 * Today, and a meeting or a task goes to All's meetings or tasks; a place
 * (Today, Unfiled, All, Settings, …) stays where it is. Null means stay.
 */
export function routeAfterSwitch(route: {
  // Structural (a `Route` fits), so the unit tests need no router.
  name: string;
  org?: string;
  [key: string]: unknown;
}): { name: 'today' } | { name: 'all'; kinds: ['meeting' | 'task'] } | null {
  if (route.name === 'project' || route.name === 'person') {
    return { name: 'today' };
  }
  if (route.name === 'meeting') return { name: 'all', kinds: ['meeting'] };
  if (route.name === 'task') return { name: 'all', kinds: ['task'] };
  // A project's whiteboard belongs to the space too; the space's own
  // board stays (the next space's board).
  if (route.name === 'whiteboard' && route.project) return { name: 'today' };
  if (route.name === 'orgs' && route.org) return { name: 'today' };
  return null;
}

/**
 * The tab title (WCAG 2.4.2): "Tasks · Datapad", with the space's name in
 * the middle once there is more than one ("Tasks · Personal · Datapad").
 */
export function documentTitle(page?: string, space?: string | null): string {
  return [page, space, 'Datapad'].filter(Boolean).join(' · ');
}

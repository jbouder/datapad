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
 * Where switching spaces leaves you: a project, person or org belongs to
 * the space you are leaving, so its page goes to Focus; a section page
 * (Tasks, Settings, …) stays where it is. Null means stay.
 */
export function routeAfterSwitch(route: {
  // Structural (a `Route` fits), so the unit tests need no router.
  name: string;
  person?: string;
  org?: string;
  [key: string]: unknown;
}): { name: 'focus' } | null {
  if (route.name === 'project') return { name: 'focus' };
  if (route.name === 'people' && route.person) return { name: 'focus' };
  if (route.name === 'orgs' && route.org) return { name: 'focus' };
  return null;
}

/**
 * The tab title (WCAG 2.4.2): "Tasks · Datapad", with the space's name in
 * the middle once there is more than one ("Tasks · Personal · Datapad").
 */
export function documentTitle(page?: string, space?: string | null): string {
  return [page, space, 'Datapad'].filter(Boolean).join(' · ');
}

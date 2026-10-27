/**
 * The navigation preferences (#187): which top-level sections the rail and
 * the tab bar show, in what order, and which of the rail's extras. Stored
 * per space in `settings.nav`; absent means today's nav. Pure, so the
 * rail, the tab bar, Settings → Navigation and the tests read the same
 * answer.
 */
import type { NavPrefs, Settings } from './types';

/** The sections, in their default order. */
export const NAV_SECTIONS = [
  'focus',
  'projects',
  'tasks',
  'meetings',
  'notes',
] as const;
export type SectionName = (typeof NAV_SECTIONS)[number];

export function isSectionName(name: unknown): name is SectionName {
  return (NAV_SECTIONS as readonly unknown[]).includes(name);
}

/** The rail's optional parts, below the sections. */
export const NAV_EXTRAS = ['activeProjects', 'digest', 'archived'] as const;
export type NavExtra = (typeof NAV_EXTRAS)[number];

/**
 * Every section in the saved order. Unknown or repeated names are
 * dropped; a section missing from the saved order (one a later release
 * added) goes back at its default place, after the section it follows by
 * default, so a saved order never hides it.
 */
export function navOrderOf(nav: NavPrefs | undefined): SectionName[] {
  const order: SectionName[] = [];
  for (const name of nav?.order ?? []) {
    if (isSectionName(name) && !order.includes(name)) order.push(name);
  }
  NAV_SECTIONS.forEach((name, i) => {
    if (order.includes(name)) return;
    const before = i === 0 ? -1 : order.indexOf(NAV_SECTIONS[i - 1]);
    order.splice(before + 1, 0, name);
  });
  return order;
}

/** The hidden sections that are real, never all of them. */
export function navHiddenOf(nav: NavPrefs | undefined): Set<SectionName> {
  const hidden = new Set((nav?.hidden ?? []).filter(isSectionName));
  if (hidden.size >= NAV_SECTIONS.length) {
    // At least one section stays: the first in the order.
    hidden.delete(navOrderOf(nav)[0]);
  }
  return hidden;
}

/** The visible sections, in order: what the rail and the tab bar show. */
export function navOf(settings: Pick<Settings, 'nav'>): SectionName[] {
  const hidden = navHiddenOf(settings.nav);
  return navOrderOf(settings.nav).filter((name) => !hidden.has(name));
}

/** Whether each rail extra is shown (all are, by default). */
export function navExtrasOf(
  settings: Pick<Settings, 'nav'>,
): Record<NavExtra, boolean> {
  const extras = settings.nav?.extras;
  return {
    activeProjects: extras?.activeProjects !== false,
    digest: extras?.digest !== false,
    archived: extras?.archived !== false,
  };
}

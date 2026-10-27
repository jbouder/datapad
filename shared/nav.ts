/**
 * The navigation preferences (#187): which top-level sections the rail and
 * the tab bar show, in what order, which of the rail's extras, and what
 * the top bar's + offers (#201). Stored per space in `settings.nav`;
 * absent means today's nav. Pure, so the rail, the tab bar, the top bar,
 * Settings → Navigation and the tests read the same answer.
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

/**
 * What the top bar's + can offer (#201), in their default order. Each
 * opens what it opens elsewhere: the new-task panel, the new-note panel,
 * the meeting form, the project form.
 */
export const QUICK_ADD_ACTIONS = [
  'task',
  'note',
  'meeting',
  'project',
] as const;
export type QuickAddAction = (typeof QUICK_ADD_ACTIONS)[number];

/** Hidden until shown: + is Add task and Write a note by default. */
const QUICK_ADD_HIDDEN: readonly QuickAddAction[] = ['meeting', 'project'];

export function isQuickAddAction(name: unknown): name is QuickAddAction {
  return (QUICK_ADD_ACTIONS as readonly unknown[]).includes(name);
}

type QuickAddPrefs = NavPrefs['quickAdd'];

/**
 * Every action in the saved order, as `navOrderOf` does for sections:
 * unknown and repeated names dropped, one missing (a later release's) at
 * its default place.
 */
export function quickAddOrderOf(prefs: QuickAddPrefs): QuickAddAction[] {
  const order: QuickAddAction[] = [];
  for (const name of prefs?.order ?? []) {
    if (isQuickAddAction(name) && !order.includes(name)) order.push(name);
  }
  QUICK_ADD_ACTIONS.forEach((name, i) => {
    if (order.includes(name)) return;
    const before = i === 0 ? -1 : order.indexOf(QUICK_ADD_ACTIONS[i - 1]);
    order.splice(before + 1, 0, name);
  });
  return order;
}

/**
 * The hidden actions. One the saved preferences never mention (a later
 * release's) keeps its default, so they never hide it by accident; at
 * least one action stays shown, the first in the order.
 */
export function quickAddHiddenOf(prefs: QuickAddPrefs): Set<QuickAddAction> {
  const known = new Set([...(prefs?.order ?? []), ...(prefs?.hidden ?? [])]);
  const saved = new Set(prefs?.hidden ?? []);
  const hidden = new Set(
    QUICK_ADD_ACTIONS.filter((name) =>
      known.has(name) ? saved.has(name) : QUICK_ADD_HIDDEN.includes(name),
    ),
  );
  if (hidden.size >= QUICK_ADD_ACTIONS.length) {
    hidden.delete(quickAddOrderOf(prefs)[0]);
  }
  return hidden;
}

/** The shown actions, in order: what + offers (one: what it does). */
export function quickAddOf(settings: Pick<Settings, 'nav'>): QuickAddAction[] {
  const prefs = settings.nav?.quickAdd;
  const hidden = quickAddHiddenOf(prefs);
  return quickAddOrderOf(prefs).filter((name) => !hidden.has(name));
}

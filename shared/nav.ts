/**
 * The navigation preferences (#187): which top-level sections the rail and
 * the tab bar show, in what order, which of those the phone's tab bar
 * leaves out, the tools (#261: Notepad, Whiteboard, Weekly digest) the
 * same way, which of the rail's extras, and what the top bar's + offers
 * (#201). Stored per space in `settings.nav`; absent means today's nav.
 * Pure, so the rail, the tab bar, the account menu, the top bar, Settings
 * → Navigation and the tests read the same answer.
 */
import type { NavPrefs, Settings } from './types';

/** The sections, in their default order: the data. */
export const NAV_SECTIONS = [
  'focus',
  'projects',
  'tasks',
  'meetings',
  'notes',
] as const;
export type SectionName = (typeof NAV_SECTIONS)[number];

/**
 * What a `setNav` op may name among the sections: these and the
 * Whiteboard, a section until #261, so an older client's change still
 * applies. The readers ignore it there.
 */
export const NAV_SECTION_NAMES = [...NAV_SECTIONS, 'whiteboard'] as const;

/** The tools (#261), in their default order: below the sections. */
export const NAV_TOOLS = ['notepad', 'whiteboard', 'digest'] as const;
export type ToolName = (typeof NAV_TOOLS)[number];

/** The tab bar's most columns: past it, tools go to the account menu. */
export const TAB_BAR_MAX = 6;

export function isSectionName(name: unknown): name is SectionName {
  return (NAV_SECTIONS as readonly unknown[]).includes(name);
}

export function isToolName(name: unknown): name is ToolName {
  return (NAV_TOOLS as readonly unknown[]).includes(name);
}

/** The rail's optional parts, below the tools. */
export const NAV_EXTRAS = ['activeProjects', 'archived'] as const;
export type NavExtra = (typeof NAV_EXTRAS)[number];

/**
 * Every name of `all` in the saved order. Unknown or repeated names are
 * dropped; one missing from the saved order (a later release's) goes back
 * at its default place, after the one it follows by default, so a saved
 * order never hides it.
 */
function orderOf<T extends string>(
  all: readonly T[],
  saved: readonly string[] | undefined,
): T[] {
  const order: T[] = [];
  for (const name of saved ?? []) {
    const known = all.find((n) => n === name);
    if (known && !order.includes(known)) order.push(known);
  }
  all.forEach((name, i) => {
    if (order.includes(name)) return;
    const prev = all[i - 1];
    const before = prev === undefined ? -1 : order.indexOf(prev);
    order.splice(before + 1, 0, name);
  });
  return order;
}

/** Every section in the saved order (see `orderOf`). */
export function navOrderOf(nav: NavPrefs | undefined): SectionName[] {
  return orderOf(NAV_SECTIONS, nav?.order);
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

/** The visible sections, in order: what the rail shows. */
export function navOf(settings: Pick<Settings, 'nav'>): SectionName[] {
  const hidden = navHiddenOf(settings.nav);
  return navOrderOf(settings.nav).filter((name) => !hidden.has(name));
}

/**
 * The sections the phone's tab bar leaves out, among the shown ones (every
 * section is on it by default). At least one shown section stays on the
 * phone, the first in the order.
 */
export function navPhoneHiddenOf(nav: NavPrefs | undefined): Set<SectionName> {
  const hidden = new Set((nav?.phoneHidden ?? []).filter(isSectionName));
  const shown = navOf({ nav });
  if (shown.every((name) => hidden.has(name))) hidden.delete(shown[0]);
  return hidden;
}

/** The sections the phone's tab bar shows, in order. */
export function navPhoneOf(settings: Pick<Settings, 'nav'>): SectionName[] {
  const hidden = navPhoneHiddenOf(settings.nav);
  return navOf(settings).filter((name) => !hidden.has(name));
}

/** Every tool in the saved order (see `orderOf`). */
export function toolsOrderOf(nav: NavPrefs | undefined): ToolName[] {
  return orderOf(NAV_TOOLS, nav?.tools?.order);
}

/**
 * The names saved tool preferences know: a tool they never name (a later
 * release's) keeps its defaults.
 */
function knownTools(tools: NonNullable<NavPrefs['tools']>): Set<string> {
  return new Set([
    ...(tools.order ?? []),
    ...(tools.hidden ?? []),
    ...(tools.phoneHidden ?? []),
  ]);
}

/**
 * The hidden tools (every one can be hidden; none is by default). Until
 * `nav.tools` is saved, the preferences from before tools carry over: the
 * Whiteboard is hidden if it was a hidden section, the Weekly digest if
 * its rail extra was off.
 */
export function toolsHiddenOf(nav: NavPrefs | undefined): Set<ToolName> {
  const tools = nav?.tools;
  if (tools) {
    const known = knownTools(tools);
    const saved = tools.hidden ?? [];
    return new Set(
      NAV_TOOLS.filter((name) => known.has(name) && saved.includes(name)),
    );
  }
  const hidden = new Set<ToolName>();
  if (nav?.hidden?.includes('whiteboard')) hidden.add('whiteboard');
  if (nav?.extras?.digest === false) hidden.add('digest');
  return hidden;
}

/**
 * The tools the phone's tab bar leaves out, shown or not: all of them by
 * default. Until `nav.tools` is saved, the Whiteboard's Phone switch is
 * what it was as a section.
 */
export function toolsPhoneHiddenOf(nav: NavPrefs | undefined): Set<ToolName> {
  const tools = nav?.tools;
  if (tools) {
    const known = knownTools(tools);
    const saved = tools.phoneHidden ?? [];
    return new Set(
      NAV_TOOLS.filter((name) => !known.has(name) || saved.includes(name)),
    );
  }
  const hidden = new Set<ToolName>(NAV_TOOLS);
  const saved = nav?.phoneHidden;
  const known = new Set([
    ...(nav?.order ?? []),
    ...(nav?.hidden ?? []),
    ...(saved ?? []),
  ]);
  if (saved && known.has('whiteboard') && !saved.includes('whiteboard')) {
    hidden.delete('whiteboard');
  }
  return hidden;
}

/**
 * The tool preferences as they read now, whole: what Settings saves, so
 * the first save keeps what carried over from before tools.
 */
export function toolsPrefsOf(nav: NavPrefs | undefined): {
  order: ToolName[];
  hidden: ToolName[];
  phoneHidden: ToolName[];
} {
  return {
    order: toolsOrderOf(nav),
    hidden: [...toolsHiddenOf(nav)],
    phoneHidden: [...toolsPhoneHiddenOf(nav)],
  };
}

/** The shown tools, in order: what the rail shows under Tools. */
export function navToolsOf(settings: Pick<Settings, 'nav'>): ToolName[] {
  const hidden = toolsHiddenOf(settings.nav);
  return toolsOrderOf(settings.nav).filter((name) => !hidden.has(name));
}

/**
 * The tools the phone's tab bar shows, after the sections: the shown ones
 * with Phone on, in order, as many as fit in its six columns.
 */
export function navPhoneToolsOf(settings: Pick<Settings, 'nav'>): ToolName[] {
  const off = toolsPhoneHiddenOf(settings.nav);
  const room = Math.max(0, TAB_BAR_MAX - navPhoneOf(settings).length);
  return navToolsOf(settings)
    .filter((name) => !off.has(name))
    .slice(0, room);
}

/** The shown tools a phone's tab bar has not: the account menu's. */
export function navMenuToolsOf(settings: Pick<Settings, 'nav'>): ToolName[] {
  const tabs = navPhoneToolsOf(settings);
  return navToolsOf(settings).filter((name) => !tabs.includes(name));
}

/** Whether each rail extra is shown (all are, by default). */
export function navExtrasOf(
  settings: Pick<Settings, 'nav'>,
): Record<NavExtra, boolean> {
  const extras = settings.nav?.extras;
  return {
    activeProjects: extras?.activeProjects !== false,
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
  return orderOf(QUICK_ADD_ACTIONS, prefs?.order);
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

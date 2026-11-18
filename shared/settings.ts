import { prefsAsPatch, savedPrefs } from './pages';
import type { BaseOp } from './protocol';
import {
  type PageKey,
  SETTINGS_ID,
  type Settings,
  type Snapshot,
} from './types';

/**
 * Settings for v2 (#343), the pure half of each section's Reset to
 * defaults. Every option's default is in one of two places:
 * `DEFAULT_SETTINGS` (`shared/types.ts`, the space-wide options, read
 * through `settingsOf()`) and `PAGES` (`shared/pages.ts`, what each page
 * remembers: Today's under `focus`, meeting mode's under `meeting`, All's
 * under `all`). This file says which of them each section owns, and the
 * ops that put a section back to its defaults and the ops that undo that.
 * Appearance is per device, not here.
 */

/** The sections of Settings with options of the space's to reset. */
export type ResetSection = 'today' | 'rooms' | 'capture' | 'all';

/** The space-wide options each section owns (`DEFAULT_SETTINGS`). */
const OWN_SETTINGS: Record<ResetSection, readonly (keyof Settings)[]> = {
  today: [],
  rooms: ['pinned', 'railOwed', 'roomTab', 'laneLabels'],
  capture: [
    'captureAs',
    'mentionAssigns',
    'defaultPriority',
    'defaultDueDays',
    'roomNotes',
  ],
  all: [],
};

/** The pages whose saved preferences each section owns (`PAGES`). */
const OWN_PAGES: Record<ResetSection, readonly PageKey[]> = {
  today: ['focus', 'meeting'],
  rooms: ['project', 'person'],
  capture: [],
  all: ['all'],
};

/** The changes that reset a section, and the ones that undo them. */
export interface SectionReset {
  ops: BaseOp[];
  undo: BaseOp[];
}

/**
 * What resets `section`: its options cleared back to their defaults and
 * its pages' saved preferences dropped, with the ops that put back what
 * was saved; `null` when the section is at its defaults already. All's
 * saved views are the owner's, not a setting: they stay.
 */
export function resetSection(
  section: ResetSection,
  snapshot: Pick<Snapshot, 'settings'>,
): SectionReset | null {
  const stored: Partial<Settings> = snapshot.settings[SETTINGS_ID] ?? {};
  const ops: BaseOp[] = [];
  const undo: BaseOp[] = [];

  const keys = OWN_SETTINGS[section].filter((key) => stored[key] !== undefined);
  if (keys.length > 0) {
    const clear: Record<string, null> = {};
    const restore: Record<string, unknown> = {};
    for (const key of keys) {
      clear[key] = null;
      restore[key] = stored[key];
    }
    ops.push({ type: 'setSettings', patch: clear });
    undo.push({ type: 'setSettings', patch: restore } as BaseOp);
  }

  for (const page of OWN_PAGES[section]) {
    const prefs = savedPrefs(snapshot, page);
    const { views, ...rest } = prefs;
    if (Object.keys(rest).length === 0) continue;
    ops.push({ type: 'resetPagePrefs', page });
    if (views && views.length > 0) {
      ops.push({ type: 'setPagePrefs', page, patch: { views } });
    }
    undo.push({ type: 'setPagePrefs', page, patch: prefsAsPatch(prefs) });
  }

  return ops.length > 0 ? { ops, undo } : null;
}

/**
 * Settings → Appearance's defaults (#343), kept per device rather than
 * with the space: follow the system's theme, motion on, 12-hour times.
 */
export const DEVICE_DEFAULTS = {
  theme: 'system',
  motion: true,
  clock: '12h',
} as const;

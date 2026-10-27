import {
  CalendarBlankIcon,
  CalendarPlusIcon,
  CheckSquareIcon,
  CrosshairIcon,
  FolderPlusIcon,
  FoldersIcon,
  type Icon,
  NoteIcon,
  NotePencilIcon,
} from '@phosphor-icons/react';
import { useMemo } from 'react';
import {
  NAV_SECTIONS,
  type NavExtra,
  navExtrasOf,
  navOf,
  type QuickAddAction,
  quickAddOf,
  type SectionName,
} from '#shared/nav';
import { DEFAULT_SETTINGS, SETTINGS_ID } from '#shared/types';
import { useDatapad } from '@/hooks/useDatapad';
import type { Route } from '@/lib/router';

/** A top-level section, as the rail and the tab bar show it. */
export interface NavItem {
  name: SectionName;
  route: Route;
  label: string;
  icon: Icon;
}

export const NAV_ITEMS: Record<SectionName, NavItem> = {
  focus: {
    name: 'focus',
    route: { name: 'focus' },
    label: 'Focus',
    icon: CrosshairIcon,
  },
  projects: {
    name: 'projects',
    route: { name: 'projects' },
    label: 'Projects',
    icon: FoldersIcon,
  },
  tasks: {
    name: 'tasks',
    route: { name: 'tasks' },
    label: 'Tasks',
    icon: CheckSquareIcon,
  },
  meetings: {
    name: 'meetings',
    route: { name: 'meetings' },
    label: 'Meetings',
    icon: CalendarBlankIcon,
  },
  notes: {
    name: 'notes',
    route: { name: 'notes' },
    label: 'Notes',
    icon: NoteIcon,
  },
};

/** Every section in the default order (⌘K lists them all, hidden or not). */
export const NAV: NavItem[] = NAV_SECTIONS.map((name) => NAV_ITEMS[name]);

/** One of the + menu's actions, as the top bar and Settings show it. */
export interface QuickAddItem {
  name: QuickAddAction;
  label: string;
  icon: Icon;
  /** Its page-wide key, if it has one: shown on desktop. */
  shortcut?: { label: string; keys: string };
}

export const QUICK_ADD_ITEMS: Record<QuickAddAction, QuickAddItem> = {
  task: {
    name: 'task',
    label: 'Add task',
    icon: CheckSquareIcon,
    shortcut: { label: 'N', keys: 'N' },
  },
  note: {
    name: 'note',
    label: 'Write a note',
    icon: NotePencilIcon,
    shortcut: { label: '⇧N', keys: 'Shift+N' },
  },
  meeting: { name: 'meeting', label: 'Add meeting', icon: CalendarPlusIcon },
  project: { name: 'project', label: 'Add project', icon: FolderPlusIcon },
};

/**
 * The sections the rail and the tab bar show, in the open space's order,
 * which of the rail's extras are on, and what the top bar's + offers
 * (Settings → Navigation).
 */
export function useNav(): {
  items: NavItem[];
  extras: Record<NavExtra, boolean>;
  quickAdd: QuickAddItem[];
} {
  const { state } = useDatapad();
  const stored = state?.settings[SETTINGS_ID] ?? DEFAULT_SETTINGS;
  return useMemo(
    () => ({
      items: navOf(stored).map((name) => NAV_ITEMS[name]),
      extras: navExtrasOf(stored),
      quickAdd: quickAddOf(stored).map((name) => QUICK_ADD_ITEMS[name]),
    }),
    [stored],
  );
}

export { sectionOf, titleOf } from '#shared/routes';

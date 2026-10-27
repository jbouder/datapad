import {
  CalendarBlankIcon,
  CheckSquareIcon,
  CrosshairIcon,
  FoldersIcon,
  type Icon,
  NoteIcon,
} from '@phosphor-icons/react';
import { useMemo } from 'react';
import {
  NAV_SECTIONS,
  type NavExtra,
  navExtrasOf,
  navOf,
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

/**
 * The sections the rail and the tab bar show, in the open space's order,
 * and which of the rail's extras are on (Settings → Navigation).
 */
export function useNav(): {
  items: NavItem[];
  extras: Record<NavExtra, boolean>;
} {
  const { state } = useDatapad();
  const stored = state?.settings[SETTINGS_ID] ?? DEFAULT_SETTINGS;
  return useMemo(
    () => ({
      items: navOf(stored).map((name) => NAV_ITEMS[name]),
      extras: navExtrasOf(stored),
    }),
    [stored],
  );
}

export { sectionOf, titleOf } from '#shared/routes';

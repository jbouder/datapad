import {
  CalendarBlankIcon,
  CalendarPlusIcon,
  ChalkboardSimpleIcon,
  CheckSquareIcon,
  CrosshairIcon,
  FolderPlusIcon,
  FoldersIcon,
  type Icon,
  NewspaperIcon,
  NoteIcon,
  NotePencilIcon,
} from '@phosphor-icons/react';
import { useMemo } from 'react';
import {
  NAV_SECTIONS,
  NAV_TOOLS,
  type NavExtra,
  navExtrasOf,
  navMenuToolsOf,
  navOf,
  navPhoneOf,
  navPhoneToolsOf,
  navToolsOf,
  type QuickAddAction,
  quickAddOf,
  type SectionName,
  type ToolName,
} from '#shared/nav';
import { DEFAULT_SETTINGS, SETTINGS_ID } from '#shared/types';
import { useDatapad } from '@/hooks/useDatapad';
import type { Route } from '@/lib/router';

/** A top-level section or a tool, as the rail and the tab bar show it. */
export interface NavItem {
  name: SectionName | ToolName;
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

/** The tools (#261): below the sections in the rail. */
export const TOOL_ITEMS: Record<ToolName, NavItem> = {
  notepad: {
    name: 'notepad',
    route: { name: 'notepad' },
    label: 'Notepad',
    icon: NotePencilIcon,
  },
  whiteboard: {
    name: 'whiteboard',
    route: { name: 'whiteboard' },
    label: 'Whiteboard',
    icon: ChalkboardSimpleIcon,
  },
  digest: {
    name: 'digest',
    route: { name: 'digest' },
    label: 'Weekly digest',
    icon: NewspaperIcon,
  },
};

/**
 * Every section, then every tool, in the default order (⌘K lists them
 * all, hidden or not).
 */
export const NAV: NavItem[] = [
  ...NAV_SECTIONS.map((name) => NAV_ITEMS[name]),
  ...NAV_TOOLS.map((name) => TOOL_ITEMS[name]),
];

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
 * The sections the rail shows, in the open space's order, and the tools
 * under them; what the phone's tab bar shows (sections, then tools) and
 * the shown tools it leaves to the account menu; which of the rail's
 * extras are on, and what the top bar's + offers (Settings → Navigation).
 */
export function useNav(): {
  items: NavItem[];
  tools: NavItem[];
  phoneItems: NavItem[];
  menuTools: NavItem[];
  extras: Record<NavExtra, boolean>;
  quickAdd: QuickAddItem[];
} {
  const { state } = useDatapad();
  const stored = state?.settings[SETTINGS_ID] ?? DEFAULT_SETTINGS;
  return useMemo(
    () => ({
      items: navOf(stored).map((name) => NAV_ITEMS[name]),
      tools: navToolsOf(stored).map((name) => TOOL_ITEMS[name]),
      phoneItems: [
        ...navPhoneOf(stored).map((name) => NAV_ITEMS[name]),
        ...navPhoneToolsOf(stored).map((name) => TOOL_ITEMS[name]),
      ],
      menuTools: navMenuToolsOf(stored).map((name) => TOOL_ITEMS[name]),
      extras: navExtrasOf(stored),
      quickAdd: quickAddOf(stored).map((name) => QUICK_ADD_ITEMS[name]),
    }),
    [stored],
  );
}

export { sectionOf, titleOf } from '#shared/routes';

import {
  BuildingsIcon,
  CalendarBlankIcon,
  CheckSquareIcon,
  CrosshairIcon,
  FoldersIcon,
  type Icon,
  NoteIcon,
  UsersIcon,
} from '@phosphor-icons/react';
import type { Route, RouteName } from '@/lib/router';

/** The top-level sections, in rail and tab-bar order. */
export interface NavItem {
  route: Route;
  label: string;
  icon: Icon;
  /** In the rail only: the phone's tab bar holds five. */
  desktopOnly?: boolean;
}

export const NAV: NavItem[] = [
  { route: { name: 'focus' }, label: 'Focus', icon: CrosshairIcon },
  { route: { name: 'projects' }, label: 'Projects', icon: FoldersIcon },
  { route: { name: 'tasks' }, label: 'Tasks', icon: CheckSquareIcon },
  { route: { name: 'events' }, label: 'Events', icon: CalendarBlankIcon },
  { route: { name: 'notes' }, label: 'Notes', icon: NoteIcon },
  {
    route: { name: 'people' },
    label: 'People',
    icon: UsersIcon,
    desktopOnly: true,
  },
  {
    route: { name: 'orgs' },
    label: 'Orgs',
    icon: BuildingsIcon,
    desktopOnly: true,
  },
];

const TITLES: Partial<Record<RouteName, string>> = {
  focus: 'Focus',
  projects: 'Projects',
  archive: 'Archived',
  tasks: 'Tasks',
  notes: 'Notes',
  events: 'Events',
  decisions: 'Decisions',
  digest: 'Weekly digest',
  people: 'People',
  orgs: 'Orgs',
  settings: 'Settings',
  help: 'Help',
  devComponents: 'Components',
  notFound: 'Not found',
};

/** The section a route belongs to, for `aria-current` in the nav. */
export function sectionOf(route: Route): RouteName {
  return route.name === 'project' || route.name === 'archive'
    ? 'projects'
    : route.name;
}

/** The top bar's title; a project page passes its name. */
export function titleOf(route: Route, projectName?: string): string {
  if (route.name === 'project') return projectName ?? 'Project';
  return TITLES[route.name] ?? 'Datapad';
}

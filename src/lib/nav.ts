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
import type { Route } from '@/lib/router';

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
  { route: { name: 'meetings' }, label: 'Meetings', icon: CalendarBlankIcon },
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

export { sectionOf, titleOf } from '#shared/routes';

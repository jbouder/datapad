import {
  CalendarBlankIcon,
  CheckSquareIcon,
  CrosshairIcon,
  FoldersIcon,
  type Icon,
  NoteIcon,
} from '@phosphor-icons/react';
import type { Route } from '@/lib/router';

/** The top-level sections, in rail and tab-bar order. */
export interface NavItem {
  route: Route;
  label: string;
  icon: Icon;
}

export const NAV: NavItem[] = [
  { route: { name: 'focus' }, label: 'Focus', icon: CrosshairIcon },
  { route: { name: 'projects' }, label: 'Projects', icon: FoldersIcon },
  { route: { name: 'tasks' }, label: 'Tasks', icon: CheckSquareIcon },
  { route: { name: 'meetings' }, label: 'Meetings', icon: CalendarBlankIcon },
  { route: { name: 'notes' }, label: 'Notes', icon: NoteIcon },
];

export { sectionOf, titleOf } from '#shared/routes';

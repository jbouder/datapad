import {
  CalendarPlusIcon,
  CheckSquareIcon,
  FolderPlusIcon,
  type Icon,
  NotePencilIcon,
  SquaresFourIcon,
  SunIcon,
  TrayIcon,
} from '@phosphor-icons/react';
import type { Place } from '#shared/routes';
import type { Route } from '@/lib/router';

/** One of the three places, as the rail and the tab bar show it (#329). */
export interface PlaceItem {
  name: Place;
  route: Route;
  label: string;
  icon: Icon;
}

/** Today, Unfiled and All: the rail's top and the phone's three tabs. */
export const PLACES: PlaceItem[] = [
  { name: 'today', route: { name: 'today' }, label: 'Today', icon: SunIcon },
  {
    name: 'unfiled',
    route: { name: 'unfiled' },
    label: 'Unfiled',
    icon: TrayIcon,
  },
  { name: 'all', route: { name: 'all' }, label: 'All', icon: SquaresFourIcon },
];

/** What the top bar's + offers, until the capture line (#330). */
export type QuickAddAction = 'task' | 'note' | 'meeting' | 'project';

/** One of the + menu's actions. */
export interface QuickAddItem {
  name: QuickAddAction;
  label: string;
  icon: Icon;
  /** Its page-wide key, if it has one: shown on desktop. */
  shortcut?: { label: string; keys: string };
}

/**
 * The + menu: Add task, Write a note, Add meeting and Add project. Fixed
 * since Settings → Navigation retired (#329).
 */
export const QUICK_ADD: QuickAddItem[] = [
  {
    name: 'task',
    label: 'Add task',
    icon: CheckSquareIcon,
    shortcut: { label: 'N', keys: 'N' },
  },
  {
    name: 'note',
    label: 'Write a note',
    icon: NotePencilIcon,
    shortcut: { label: '⇧N', keys: 'Shift+N' },
  },
  { name: 'meeting', label: 'Add meeting', icon: CalendarPlusIcon },
  { name: 'project', label: 'Add project', icon: FolderPlusIcon },
];

export { placeOf, titleOf } from '#shared/routes';

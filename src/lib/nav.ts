import {
  DoorOpenIcon,
  type Icon,
  SquaresFourIcon,
  SunIcon,
  TrayIcon,
} from '@phosphor-icons/react';
import type { Place } from '#shared/routes';
import type { Route } from '@/lib/router';

/** A place, as the rail and the tab bar show it (#329). */
export interface PlaceItem {
  name: Place;
  route: Route;
  label: string;
  icon: Icon;
}

/** Today, Scratch and All: the rail's top and the phone's three tabs. */
export const PLACES: PlaceItem[] = [
  { name: 'today', route: { name: 'today' }, label: 'Today', icon: SunIcon },
  {
    name: 'scratch',
    route: { name: 'scratch' },
    label: 'Scratch',
    icon: TrayIcon,
  },
  { name: 'all', route: { name: 'all' }, label: 'All', icon: SquaresFourIcon },
];

/**
 * The phone's Rooms tab, between Scratch and All: the rail's rooms as a
 * page. The rail lists the rooms themselves, so it has no such row.
 */
export const ROOMS_TAB: PlaceItem = {
  name: 'rooms',
  route: { name: 'rooms' },
  label: 'Rooms',
  icon: DoorOpenIcon,
};

export { placeOf, titleOf } from '#shared/routes';

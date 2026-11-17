import {
  type Icon,
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

export { placeOf, titleOf } from '#shared/routes';

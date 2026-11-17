import { useMemo } from 'react';
import { allHome } from '#shared/pages';
import { useDatapad } from '@/hooks/useDatapad';
import { PLACES, type PlaceItem } from '@/lib/nav';

/**
 * Today, Scratch and All as the rail, the tab bar and ⌘K link them: All
 * opens on the kinds set in Settings → All (#343), Tasks until changed.
 */
export function usePlaces(): PlaceItem[] {
  const { state } = useDatapad();
  const key = state ? allHome(state).join(',') : 'task';
  return useMemo(() => {
    const kinds = key ? key.split(',') : [];
    return PLACES.map((place) =>
      place.name === 'all'
        ? {
            ...place,
            route:
              kinds.length > 0
                ? ({ name: 'all', kinds } as PlaceItem['route'])
                : place.route,
          }
        : place,
    );
  }, [key]);
}

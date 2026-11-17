import { ALL_ROOMS_QUERY } from '#shared/all';
import { RoomLists } from '@/components/RoomLists';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRooms } from '@/hooks/useRooms';
import { linkProps } from '@/lib/router';

/** All's rooms list: where every room is found and pinned. */
const allRooms = () => linkProps({ name: 'all' }, ALL_ROOMS_QUERY);

/**
 * Rooms (`/rooms`): the phone's Rooms tab, the rail's rooms as a page
 * (`useRooms`, `RoomLists`): the same rows in the same order, with the
 * same counts, in 44px rows. All finds every other project and person.
 * Desktop has the rail, but the page works there too.
 */
export function RoomsPage() {
  usePageTitle('Rooms');
  const list = useRooms({ name: 'rooms' });
  const empty = list && list.rooms.length === 0 && list.owed.length === 0;

  return (
    // Not a labelled region: its Rooms section below is that.
    <div className="enter flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-page-title">Rooms</h1>
        <p className="text-sm text-muted-foreground">
          Your pinned rooms, or the active projects until you pin one, and the
          people you are waiting on.
        </p>
      </div>

      {!list ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : empty ? (
        <p className="text-state">
          No rooms yet. Find a project or person in{' '}
          <a {...allRooms()} className="underline underline-offset-4">
            All
          </a>{' '}
          and pin it.
        </p>
      ) : (
        <RoomLists list={list} look="page" id="rooms-page" />
      )}

      <p>
        <a
          {...allRooms()}
          className="inline-flex min-h-11 items-center text-sm underline underline-offset-4 desk:min-h-8"
        >
          All projects and people
        </a>
      </p>
    </div>
  );
}

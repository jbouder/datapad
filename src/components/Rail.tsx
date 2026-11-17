import { useMemo } from 'react';
import { normalViewQuery } from '#shared/all';
import {
  isRoomPage,
  owedBy,
  PERSON_PARAM,
  type Room,
  railRooms,
  roomKey,
  roomLink,
  unfiledCount,
  viewOf,
} from '#shared/rooms';
import { openCounts } from '#shared/select';
import { settingsOf } from '#shared/types';
import { SpaceSwitcher } from '@/components/SpaceSwitcher';
import { SyncStatus } from '@/components/SyncStatus';
import { useDatapad } from '@/hooks/useDatapad';
import { usePlaces } from '@/hooks/usePlaces';
import { placeOf } from '@/lib/nav';
import { linkProps, type Route, useQuery } from '@/lib/router';
import { cn } from '@/lib/utils';

/** A place's or a room's row: the same look, `aria-current` on its page. */
const ROW =
  'press flex h-9 items-center gap-2.5 px-2 text-sm outline-ring/50 hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:-outline-offset-2';
const CURRENT =
  'bg-sidebar-accent font-semibold text-sidebar-accent-foreground';
const HEADING = 'px-2 pb-1 text-xs font-medium text-muted-foreground';

/**
 * The desktop rail (≥ 820px, #329): the space switcher; Today, Unfiled
 * (with its count) and All; then Rooms: the pinned rooms in your order,
 * or before anything is pinned the active projects, most recently changed
 * first, with their open counts; then the people who owe you something,
 * with counts, until they are pinned (unless Settings → Rooms leaves
 * them out); and the sync status at the foot. All opens on the kinds
 * Settings → All names.
 * Hidden below 820px, where the tab bar takes over.
 */
export function Rail({ route }: { route: Route }) {
  const { state } = useDatapad();
  const place = placeOf(route);
  const places = usePlaces();
  const query = useQuery();
  const narrowedTo = query.get(PERSON_PARAM);

  const rail = useMemo(() => {
    if (!state) return null;
    const settings = settingsOf(state);
    return {
      unfiled: unfiledCount(state.notes),
      rooms: railRooms(settings, state),
      // Settings → Rooms can leave them out (#343).
      owed: settings.railOwed ? owedBy(state, settings) : [],
      open: openCounts(state.tasks),
    };
  }, [state]);

  const roomLabel = (room: Room): string => {
    if (!state) return '';
    if (room.kind === 'view') return viewOf(room, state)?.name ?? '';
    if (room.kind === 'project') return state.projects[room.id]?.name ?? '';
    if (room.kind === 'person') return state.people[room.id]?.name ?? '';
    const project = state.projects[room.project]?.name ?? '';
    const person = state.people[room.person]?.name ?? '';
    return `${project} · ${person}`;
  };
  // The saved view All shows now, if any: its address is this one.
  const here = query.toString();
  const hereView = useMemo(() => {
    if (!state || route.name !== 'all') return undefined;
    const normal = normalViewQuery(here);
    return settingsOf(state).pages?.all?.views?.find(
      (v) => normalViewQuery(v.query) === normal,
    )?.id;
  }, [state, route.name, here]);
  const roomCount = (room: Room): number =>
    room.kind === 'project' ? (rail?.open.get(room.id) ?? 0) : 0;

  return (
    <aside
      aria-label="Datapad"
      className="vt-rail sticky top-0 hidden h-dvh w-(--rail-width) shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground desk:flex"
    >
      <SpaceSwitcher />

      <nav
        aria-label="Sections"
        className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-4"
      >
        <ul className="flex flex-col">
          {places.map(({ name, route: to, label, icon: Icon }) => {
            const current = place === name;
            const count = name === 'unfiled' ? (rail?.unfiled ?? 0) : 0;
            return (
              <li key={name}>
                <a
                  {...linkProps(to)}
                  aria-current={current ? 'page' : undefined}
                  className={cn(ROW, current && CURRENT)}
                >
                  <Icon weight={current ? 'fill' : 'regular'} aria-hidden />
                  <span className="flex-1">{label}</span>
                  {count > 0 && (
                    <span className="count text-xs text-muted-foreground tabular-nums">
                      {count}
                      <span className="sr-only"> unfiled</span>
                    </span>
                  )}
                </a>
              </li>
            );
          })}
        </ul>

        {rail && rail.rooms.rooms.length > 0 && (
          <section aria-labelledby="rail-rooms">
            <h2 id="rail-rooms" className={HEADING}>
              Rooms
            </h2>
            <ul className="flex flex-col" data-pinned={rail.rooms.pinned}>
              {rail.rooms.rooms.map((room) => {
                const current = isRoomPage(room, route, narrowedTo, hereView);
                const link = roomLink(room, state ?? {});
                const open = roomCount(room);
                return (
                  <li key={`${room.kind}:${roomKey(room)}`}>
                    <a
                      {...linkProps(link.route, link.query)}
                      aria-current={current ? 'page' : undefined}
                      className={cn(ROW, 'h-8', current && CURRENT)}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {roomLabel(room)}
                      </span>
                      {open > 0 && (
                        <span className="count text-xs text-muted-foreground tabular-nums">
                          {open}
                          <span className="sr-only"> open</span>
                        </span>
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {rail && rail.owed.length > 0 && (
          <section aria-labelledby="rail-owed">
            <h2 id="rail-owed" className={HEADING}>
              Waiting on
            </h2>
            <ul className="flex flex-col">
              {rail.owed.map(({ person, count }) => {
                const current =
                  route.name === 'person' && route.id === person.id;
                return (
                  <li key={person.id}>
                    <a
                      {...linkProps({ name: 'person', id: person.id })}
                      aria-current={current ? 'page' : undefined}
                      className={cn(ROW, 'h-8', current && CURRENT)}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {person.name}
                      </span>
                      <span className="count text-xs text-muted-foreground tabular-nums">
                        {count}
                        <span className="sr-only"> waiting</span>
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </nav>

      <footer className="flex flex-col gap-2 border-t px-4 py-3">
        <SyncStatus />
      </footer>
    </aside>
  );
}

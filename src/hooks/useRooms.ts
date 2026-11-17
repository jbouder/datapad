import { useMemo } from 'react';
import { normalViewQuery } from '#shared/all';
import {
  isRoomPage,
  narrowedOf,
  owedBy,
  type Room,
  railRooms,
  roomKey,
  roomLink,
  unfiledCount,
  viewOf,
} from '#shared/rooms';
import { openCounts } from '#shared/select';
import { type Snapshot, settingsOf } from '#shared/types';
import { useDatapad } from '@/hooks/useDatapad';
import { type Route, useQuery } from '@/lib/router';

/** One row of the rooms list: where it goes, its label and count. */
export interface RoomRow {
  key: string;
  label: string;
  route: Route;
  query: string;
  /** Open tasks for a project, waiting tasks for a person owed; else 0. */
  count: number;
  /** Whether the page shown is this row's. */
  current: boolean;
}

/** The rooms list as the rail and the phone's Rooms page show it. */
export interface RoomsList {
  /** Whether `rooms` are the pins, or (none pinned) the active projects. */
  pinned: boolean;
  rooms: RoomRow[];
  /** The people who owe you something, unless Settings → Rooms hides them. */
  owed: RoomRow[];
  /** Unfiled's count, for the rail. */
  unfiled: number;
}

function roomLabel(room: Room, state: Snapshot): string {
  if (room.kind === 'view') return viewOf(room, state)?.name ?? '';
  if (room.kind === 'project') return state.projects[room.id]?.name ?? '';
  if (room.kind === 'person') return state.people[room.id]?.name ?? '';
  const project = state.projects[room.project]?.name ?? '';
  const person = state.people[room.person]?.name ?? '';
  return `${project} · ${person}`;
}

/**
 * The rail's rooms (#329), one source for the desktop rail and the
 * phone's Rooms page: the pinned rooms in your order, or before anything
 * is pinned the active projects, most recently changed first, with their
 * open counts; then the people who owe you something, with counts, until
 * they are pinned (unless Settings → Rooms leaves them out). Null until
 * the data is in.
 */
export function useRooms(route: Route): RoomsList | null {
  const { state } = useDatapad();
  const query = useQuery();
  const narrowedTo = narrowedOf(route, query);
  // The saved view All shows now, if any: its address is this one.
  const here = query.toString();
  const hereView = useMemo(() => {
    if (!state || route.name !== 'all') return undefined;
    const normal = normalViewQuery(here);
    return settingsOf(state).pages?.all?.views?.find(
      (v) => normalViewQuery(v.query) === normal,
    )?.id;
  }, [state, route.name, here]);

  const data = useMemo(() => {
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

  if (!state || !data) return null;
  return {
    pinned: data.rooms.pinned,
    unfiled: data.unfiled,
    rooms: data.rooms.rooms.map((room) => {
      const link = roomLink(room, state);
      return {
        key: `${room.kind}:${roomKey(room)}`,
        label: roomLabel(room, state),
        route: link.route,
        query: link.query,
        count: room.kind === 'project' ? (data.open.get(room.id) ?? 0) : 0,
        current: isRoomPage(room, route, narrowedTo, hereView),
      };
    }),
    owed: data.owed.map(({ person, count }) => ({
      key: person.id,
      label: person.name,
      route: { name: 'person', id: person.id },
      query: '',
      count,
      current: route.name === 'person' && route.id === person.id,
    })),
  };
}

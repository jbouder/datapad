import { ArrowDownIcon, ArrowUpIcon, XIcon } from '@phosphor-icons/react';
import { useLayoutEffect, useRef } from 'react';
import { viewRoute } from '#shared/all';
import { pinnedRooms, type Room, roomKey, viewOf } from '#shared/rooms';
import { settingsOf } from '#shared/types';
import { ResetToDefaults } from '@/components/settings/parts';
import { RoomOptions } from '@/components/settings/RoomOptions';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { useFlip } from '@/hooks/useFlip';
import { usePins } from '@/hooks/usePins';
import { linkProps, type Route } from '@/lib/router';
import { useMotion } from '@/providers/MotionProvider';

const ICON_BUTTON = 'press size-11 desk:size-8';

/**
 * Settings → Rooms (#329, #343): the pinned rooms in the rail's order,
 * each with Move up, Move down and Unpin, 44px on touch (pin and unpin
 * from a room's header too), then the rooms' options (`RoomOptions`).
 * Per space; Reset to defaults unpins everything and puts the options
 * back, with Undo.
 */
export function RoomsSettings() {
  const { state } = useDatapad();
  const { active } = useMotion();
  const { move, setPinned } = usePins();
  const list = useRef<HTMLUListElement>(null);
  useFlip(list, active);

  // A move re-renders the rows: keep focus on the button pressed, or its
  // neighbor once that one is disabled at the end of the list.
  const refocus = useRef<{ key: string; by: -1 | 1 } | null>(null);
  useLayoutEffect(() => {
    const want = refocus.current;
    if (!want) return;
    refocus.current = null;
    const button = (by: number) =>
      list.current?.querySelector<HTMLButtonElement>(
        `[data-move="${CSS.escape(`${want.key}:${by}`)}"]`,
      );
    const pressed = button(want.by);
    (pressed && !pressed.disabled ? pressed : button(-want.by))?.focus();
  });

  if (!state) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const rooms = pinnedRooms(settingsOf(state), state);

  const nameOf = (room: Room): string => {
    if (room.kind === 'view') return viewOf(room, state)?.name ?? '';
    if (room.kind === 'project') return state.projects[room.id]?.name ?? '';
    if (room.kind === 'person') return state.people[room.id]?.name ?? '';
    const project = state.projects[room.project]?.name ?? '';
    const person = state.people[room.person]?.name ?? '';
    return `${project} · ${person}`;
  };
  const linkOf = (room: Room): [Route, string?] => {
    if (room.kind === 'view') {
      const to = viewRoute(viewOf(room, state)?.query ?? '');
      return [to.route, to.query];
    }
    return room.kind === 'person'
      ? [{ name: 'person', id: room.id }]
      : [
          {
            name: 'project',
            id: room.kind === 'project' ? room.id : room.project,
          },
        ];
  };
  const kindOf = (room: Room): string =>
    room.kind === 'project'
      ? 'Project'
      : room.kind === 'person'
        ? 'Person'
        : room.kind === 'view'
          ? 'Saved view on All'
          : 'Project and person';

  const moveRoom = (key: string, by: -1 | 1) => {
    refocus.current = { key, by };
    if (!move(key, by)) refocus.current = null;
  };

  return (
    <>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          The rooms pinned to the rail, in its order. Pin a project or a person
          from its room’s header, and a saved view from its menu on All. With
          nothing pinned, the rail lists the active projects.
        </p>
        <ResetToDefaults section="rooms" label="Rooms" />
      </div>
      {rooms.length === 0 ? (
        <p className="text-state">Nothing pinned yet.</p>
      ) : (
        <ul
          ref={list}
          aria-label="Pinned rooms"
          className="flex flex-col border-t"
        >
          {rooms.map((room, i) => {
            const key = roomKey(room);
            const name = nameOf(room);
            return (
              <li
                key={key}
                data-flip-id={key}
                data-room={key}
                className="row flex items-center gap-1 border-b bg-background text-sm"
              >
                <span className="flex min-h-11 min-w-0 flex-1 flex-col justify-center desk:min-h-9">
                  <a
                    {...linkProps(...linkOf(room))}
                    className="truncate font-medium hover:underline"
                  >
                    {name}
                  </a>
                  <span className="text-xs text-muted-foreground">
                    {kindOf(room)}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className={ICON_BUTTON}
                  title="Move up"
                  data-move={`${key}:-1`}
                  disabled={i === 0}
                  onClick={() => moveRoom(key, -1)}
                >
                  <ArrowUpIcon />
                  <span className="sr-only">Move {name} up</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={ICON_BUTTON}
                  title="Move down"
                  data-move={`${key}:1`}
                  disabled={i === rooms.length - 1}
                  onClick={() => moveRoom(key, 1)}
                >
                  <ArrowDownIcon />
                  <span className="sr-only">Move {name} down</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={ICON_BUTTON}
                  title="Unpin"
                  onClick={() => setPinned(room, false)}
                >
                  <XIcon />
                  <span className="sr-only">Unpin {name}</span>
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <RoomOptions />
    </>
  );
}

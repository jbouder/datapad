import { useCallback } from 'react';
import { isPinned, movePin, type Room, withPin } from '#shared/rooms';
import { settingsOf } from '#shared/types';
import { useDatapad } from '@/hooks/useDatapad';

/**
 * The open space's pinned rooms (#329), and the setters a room's Pin
 * button and Settings → Rooms use. Each change is one `setSettings` with
 * the whole list, in order.
 */
export function usePins(): {
  pinned: (room: Room) => boolean;
  setPinned: (room: Room, on: boolean) => boolean;
  /** Move a pinned room up (-1) or down (1); false at either end. */
  move: (key: string, by: -1 | 1) => boolean;
} {
  const { state, actions } = useDatapad();
  const settings = state ? settingsOf(state) : {};
  const pinned = useCallback(
    (room: Room) => isPinned(settings, room),
    [settings],
  );
  const setPinned = useCallback(
    (room: Room, on: boolean) =>
      actions.setSettings({ patch: { pinned: withPin(settings, room, on) } }),
    [actions, settings],
  );
  const move = useCallback(
    (key: string, by: -1 | 1) => {
      if (!state) return false;
      const next = movePin(settings, state, key, by);
      return next ? actions.setSettings({ patch: { pinned: next } }) : false;
    },
    [actions, settings, state],
  );
  return { pinned, setPinned, move };
}

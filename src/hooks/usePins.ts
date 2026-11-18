import { useCallback } from 'react';
import {
  hidePatch,
  isHidden,
  isPinned,
  movePin,
  type Room,
  withPin,
} from '#shared/rooms';
import { settingsOf } from '#shared/types';
import { useDatapad } from '@/hooks/useDatapad';

/**
 * The open space's pinned rooms (#329) and hidden projects, and the
 * setters a room's Pin button, its menu and Settings → Rooms use. Each change is one `setSettings` with
 * the whole list, in order.
 */
export function usePins(): {
  pinned: (room: Room) => boolean;
  setPinned: (room: Room, on: boolean) => boolean;
  /** Move a pinned room up (-1) or down (1); false at either end. */
  move: (key: string, by: -1 | 1) => boolean;
  /** Whether a project is hidden from the rail. */
  hidden: (projectId: string) => boolean;
  /** Hide a project from the rail (unpinning it), or show it again. */
  setHidden: (projectId: string, on: boolean) => boolean;
} {
  const { state, actions } = useDatapad();
  const settings = state ? settingsOf(state) : {};
  const pinned = useCallback(
    (room: Room) => isPinned(settings, room),
    [settings],
  );
  const setPinned = useCallback(
    (room: Room, on: boolean) => {
      const pinned = withPin(settings, room, on);
      // Pinning a hidden project shows it again.
      const shown =
        on && room.kind === 'project' && isHidden(settings, room.id)
          ? hidePatch(settings, room.id, false)
          : {};
      return actions.setSettings({ patch: { ...shown, pinned } });
    },
    [actions, settings],
  );
  const hidden = useCallback(
    (projectId: string) => isHidden(settings, projectId),
    [settings],
  );
  const setHidden = useCallback(
    (projectId: string, on: boolean) =>
      actions.setSettings({ patch: hidePatch(settings, projectId, on) }),
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
  return { pinned, setPinned, move, hidden, setHidden };
}

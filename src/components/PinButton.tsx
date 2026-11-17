import { PushPinIcon } from '@phosphor-icons/react';
import type { Room } from '#shared/rooms';
import { Toggle } from '@/components/ui/toggle';
import { usePins } from '@/hooks/usePins';

/**
 * A room's Pin (#329), in its header: pressed while the room is pinned to
 * the rail (its name stays "Pin"; the pressed state says which). Pinning
 * adds it at the end; Settings → Rooms sets the order.
 */
export function PinButton({ room }: { room: Room }) {
  const { pinned, setPinned } = usePins();
  const on = pinned(room);
  return (
    <Toggle
      variant="outline"
      className="press h-11 desk:h-8"
      pressed={on}
      onPressedChange={(next) => setPinned(room, next)}
    >
      <PushPinIcon weight={on ? 'fill' : 'regular'} />
      Pin
    </Toggle>
  );
}

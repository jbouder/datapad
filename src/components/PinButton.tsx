import { PushPinIcon } from '@phosphor-icons/react';
import type { Room } from '#shared/rooms';
import { Toggle } from '@/components/ui/toggle';
import { usePins } from '@/hooks/usePins';
import { cn } from '@/lib/utils';

/**
 * A room's Pin (#329), in its header: pressed while the room is pinned to
 * the rail (its name stays "Pin"; the pressed state says which). Pinning
 * adds it at the end; Settings → Rooms sets the order. In a list of rooms
 * (All, #337) it is the pin alone, named "Pin <room>".
 */
export function PinButton({ room, name }: { room: Room; name?: string }) {
  const { pinned, setPinned } = usePins();
  const on = pinned(room);
  return (
    <Toggle
      variant="outline"
      className={cn('press h-11 desk:h-8', name && 'w-11 shrink-0 desk:w-8')}
      pressed={on}
      onPressedChange={(next) => setPinned(room, next)}
      aria-label={name ? `Pin ${name}` : undefined}
      title={name ? (on ? 'Pinned to the rail' : 'Pin to the rail') : undefined}
    >
      <PushPinIcon weight={on ? 'fill' : 'regular'} aria-hidden />
      {!name && 'Pin'}
    </Toggle>
  );
}

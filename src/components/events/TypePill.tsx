import { EVENT_TYPE_LABELS } from '#shared/events';
import type { EventType } from '#shared/types';
import { cn } from '@/lib/utils';

/**
 * Milestone: accent fill. Deadline: destructive outline. Demo: ok outline.
 * Meetings and the rest: a plain outline (docs/design.md).
 */
export function TypePill({
  type,
  className,
}: {
  type: EventType;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[11px] font-medium whitespace-nowrap',
        type === 'milestone' &&
          'border-transparent bg-accent text-accent-foreground',
        type === 'deadline' && 'border-destructive text-destructive',
        type === 'demo' && 'border-ok text-ok',
        (type === 'meeting' || type === 'other') &&
          'border-muted-foreground/40 text-muted-foreground',
        className,
      )}
    >
      {EVENT_TYPE_LABELS[type]}
    </span>
  );
}

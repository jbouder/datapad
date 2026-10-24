import type { DecisionStatus } from '#shared/types';
import { cn } from '@/lib/utils';

export const DECISION_LABELS: Record<DecisionStatus, string> = {
  proposed: 'Proposed',
  decided: 'Decided',
  revisited: 'Revisited',
};

/** Proposed: dashed. Decided: ok fill. Revisited: warn outline. Always a word. */
export function DecisionPill({
  status,
  className,
}: {
  status: DecisionStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-medium whitespace-nowrap',
        status === 'proposed' &&
          'border border-dashed border-muted-foreground/60 text-muted-foreground',
        status === 'decided' && 'bg-ok text-ok-foreground',
        status === 'revisited' && 'border border-warn text-foreground',
        className,
      )}
    >
      {DECISION_LABELS[status]}
    </span>
  );
}

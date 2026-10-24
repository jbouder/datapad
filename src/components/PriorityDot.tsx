import type { Priority } from '#shared/types';
import { cn } from '@/lib/utils';

export const PRIORITY_LABELS: Record<Priority, string> = {
  none: 'No priority',
  low: 'Low',
  med: 'Medium',
  high: 'High',
};

const DOT: Record<Priority, string> = {
  high: 'bg-destructive',
  med: 'bg-warn',
  low: 'bg-muted-foreground',
  none: 'border border-muted-foreground/60 bg-transparent',
};

/**
 * The priority dot (docs/design.md). Never colour alone: the label is
 * there for screen readers unless the caller shows it as text already.
 */
export function PriorityDot({
  priority,
  labelled = true,
  className,
}: {
  priority: Priority;
  /** Add the label as visually hidden text. */
  labelled?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center', className)}>
      <span
        aria-hidden
        className={cn('inline-block size-2.5 rounded-full', DOT[priority])}
      />
      {labelled && (
        <span className="sr-only">{PRIORITY_LABELS[priority]} priority</span>
      )}
    </span>
  );
}

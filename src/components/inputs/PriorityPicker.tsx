import { useId } from 'react';
import { PRIORITIES, type Priority } from '#shared/types';
import { PRIORITY_LABELS, PriorityDot } from '@/components/PriorityDot';
import { cn } from '@/lib/utils';

const SHORT: Record<Priority, string> = {
  none: 'None',
  low: 'Low',
  med: 'Med',
  high: 'High',
};

/**
 * Four options in a segmented row, each a real radio (arrow keys move
 * between them, Space picks). Shows the dot and a short label.
 */
export function PriorityPicker({
  value,
  onChange,
  label = 'Priority',
  className,
}: {
  value: Priority;
  onChange: (priority: Priority) => void;
  label?: string;
  className?: string;
}) {
  const name = useId();
  return (
    <fieldset className={cn('flex flex-col gap-1.5', className)}>
      <legend className="mb-1.5 text-xs font-medium">{label}</legend>
      <div className="grid grid-cols-4 border border-border">
        {PRIORITIES.map((p) => (
          <label
            key={p}
            className={cn(
              'press relative flex min-h-11 cursor-pointer items-center justify-center gap-1.5 text-xs not-last:border-r not-last:border-border has-checked:bg-accent has-checked:font-semibold has-checked:text-accent-foreground has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-ring desk:min-h-7.5',
            )}
          >
            <input
              type="radio"
              name={name}
              value={p}
              checked={value === p}
              onChange={() => onChange(p)}
              className="sr-only"
              aria-label={PRIORITY_LABELS[p]}
            />
            <PriorityDot priority={p} labeled={false} />
            <span aria-hidden>{SHORT[p]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

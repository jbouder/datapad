import { type ReactNode, useId } from 'react';
import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Shown before the label (a dot, an icon). */
  icon?: ReactNode;
}

/**
 * A row of options of which one is picked: real radios (arrow keys move,
 * Space picks) styled as a segmented control.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  legend,
  legendHidden = false,
  wrap = false,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  legend: string;
  legendHidden?: boolean;
  /** Three to a row on phones, for options too long to share one. */
  wrap?: boolean;
  className?: string;
}) {
  const name = useId();
  return (
    <fieldset className={cn('flex flex-col', className)}>
      <legend
        className={cn('mb-1.5 text-xs font-medium', legendHidden && 'sr-only')}
      >
        {legend}
      </legend>
      <div
        className={cn(
          // An inset outline, not a border: as tall as a select beside it.
          'grid outline-1 -outline-offset-1 outline-border',
          wrap &&
            'grid-cols-3 gap-px bg-border sm:grid-cols-(--cols) sm:gap-0 sm:bg-transparent',
        )}
        style={
          {
            [wrap ? '--cols' : 'gridTemplateColumns']:
              `repeat(${options.length}, minmax(0, 1fr))`,
          } as React.CSSProperties
        }
      >
        {options.map((o, i) => (
          <label
            key={o.value}
            style={
              wrap && i === options.length - 1
                ? ({
                    '--span': 3 - ((options.length - 1) % 3),
                  } as React.CSSProperties)
                : undefined
            }
            className={cn(
              'press relative flex min-h-11 cursor-pointer items-center justify-center gap-1.5 px-2 text-xs has-checked:bg-accent has-checked:font-semibold has-checked:text-accent-foreground has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-ring desk:min-h-8',
              wrap
                ? 'bg-background last:max-sm:col-span-(--span) sm:not-last:border-r sm:not-last:border-border'
                : 'not-last:border-r not-last:border-border',
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.icon}
            <span className="truncate">{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

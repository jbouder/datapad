import type { ProjectHealth } from '#shared/types';
import { Segmented } from '@/components/inputs/Segmented';
import { cn } from '@/lib/utils';

/**
 * A project's health: green, yellow, red, or not judged. Always a word as
 * well as a color (`ok`, `warn`, `destructive`), never color alone.
 */

export const HEALTH_LABELS: Record<ProjectHealth, string> = {
  none: 'Not set',
  green: 'Green',
  yellow: 'Yellow',
  red: 'Red',
};

const DOT: Record<ProjectHealth, string> = {
  none: 'border border-muted-foreground/60',
  green: 'bg-ok',
  yellow: 'bg-warn',
  red: 'bg-destructive',
};

/** The card's left edge, by health. */
export const HEALTH_EDGE: Record<ProjectHealth, string> = {
  none: '',
  green: 'border-l-4 border-l-ok',
  yellow: 'border-l-4 border-l-warn',
  red: 'border-l-4 border-l-destructive',
};

export function HealthDot({ health }: { health: ProjectHealth }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2 shrink-0 rounded-full', DOT[health])}
    />
  );
}

/** "● Red health" as text; nothing when not set. */
export function HealthBadge({
  health,
  className,
}: {
  health: ProjectHealth;
  className?: string;
}) {
  if (health === 'none') return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap',
        className,
      )}
    >
      <HealthDot health={health} />
      {HEALTH_LABELS[health]}
      <span className="sr-only"> health</span>
    </span>
  );
}

const ORDER: ProjectHealth[] = ['none', 'green', 'yellow', 'red'];

/** The four choices as a segmented control (header and form). */
export function HealthPicker({
  value,
  onChange,
  legendHidden = false,
  className,
}: {
  value: ProjectHealth;
  onChange: (health: ProjectHealth) => void;
  legendHidden?: boolean;
  className?: string;
}) {
  return (
    <Segmented
      legend="Health"
      legendHidden={legendHidden}
      value={value}
      onChange={onChange}
      className={className}
      options={ORDER.map((h) => ({
        value: h,
        label: h === 'none' ? 'None' : HEALTH_LABELS[h],
        icon: <HealthDot health={h} />,
      }))}
    />
  );
}

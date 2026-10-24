import type { ProjectStatus } from '#shared/types';
import { STATUS_LABELS } from '@/components/projects/ProjectForm';
import { cn } from '@/lib/utils';

/** Active: accent fill. Paused: dashed border. Done: ok fill (docs/design.md). */
export function StatusPill({
  status,
  className,
}: {
  status: ProjectStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium whitespace-nowrap',
        status === 'active' && 'bg-accent text-accent-foreground',
        status === 'paused' &&
          'border border-dashed border-muted-foreground/60 text-muted-foreground',
        status === 'done' && 'bg-ok text-ok-foreground',
        className,
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

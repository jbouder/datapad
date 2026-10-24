import { CloudSlashIcon } from '@phosphor-icons/react';
import { useDatapad } from '@/hooks/useDatapad';
import { cn } from '@/lib/utils';

/**
 * Whether changes are reaching the server: quiet when they are, plain about
 * it when they are not. Never a spinner, never blocking. Only connecting
 * and offline are announced; "Saving…" / "Saved" would chatter on every
 * keystroke that commits.
 *
 * M2 moves this into the rail footer (#15); until then it sits in the top
 * bar.
 */
export function SyncStatus({ className }: { className?: string }) {
  const { status, pendingCount } = useDatapad();
  const waiting =
    pendingCount === 1 ? '1 change waiting' : `${pendingCount} changes waiting`;

  const announced =
    status === 'offline'
      ? pendingCount
        ? `Offline, ${waiting}`
        : 'Offline'
      : status === 'connecting'
        ? 'Connecting…'
        : '';
  const quiet = status === 'live' ? (pendingCount ? 'Saving…' : 'Saved') : '';

  return (
    <p
      className={cn(
        'flex items-center gap-1.5 text-xs text-muted-foreground',
        status === 'offline' && 'text-warn',
        className,
      )}
      data-status={status}
    >
      {status === 'offline' && <CloudSlashIcon weight="bold" aria-hidden />}
      <span role="status">{announced}</span>
      {quiet && <span className="max-sm:sr-only">{quiet}</span>}
    </p>
  );
}

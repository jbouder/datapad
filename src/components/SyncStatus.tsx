import { CloudSlashIcon } from '@phosphor-icons/react';
import { useDatapad } from '@/hooks/useDatapad';
import { cn } from '@/lib/utils';

/**
 * Whether changes are reaching the server, at the foot of the rail on
 * desktop and in the top bar on phones: a dot colored by state (ok when saved, warn while connecting or with
 * changes waiting, destructive offline) and always a word beside it, so
 * color never carries it alone. Never a spinner, never blocking.
 *
 * On phones only the dot shows, its label visually hidden, except
 * offline, where "Offline" shows too. Only connecting and offline are
 * announced; "Saving…" / "Saved" would chatter on every keystroke that
 * commits.
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
  const offline = status === 'offline';

  return (
    <p
      className={cn(
        'flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground',
        offline && 'text-warn',
        className,
      )}
      data-status={status}
    >
      <span
        aria-hidden
        data-dot
        className={cn(
          'inline-block size-2 shrink-0 rounded-full transition-colors duration-(--duration-base) ease-(--ease-standard)',
          offline
            ? 'bg-destructive'
            : status === 'live' && !pendingCount
              ? 'bg-ok'
              : 'bg-warn',
        )}
      />
      {offline && <CloudSlashIcon weight="bold" aria-hidden />}
      <span role="status" className="sr-only desk:not-sr-only">
        {announced}
      </span>
      {offline && (
        <span aria-hidden className="desk:hidden">
          Offline
        </span>
      )}
      {quiet && <span className="sr-only desk:not-sr-only">{quiet}</span>}
    </p>
  );
}

import {
  ArrowCounterClockwiseIcon,
  DownloadSimpleIcon,
} from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { formatDay, localDate } from '#shared/dates';
import type { BackupList } from '#shared/protocol';
import { nextDailyAt } from '#shared/schedule';
import { useImportExport } from '@/components/ImportExport';
import { Button } from '@/components/ui/button';
import { backupUrl, fetchBackups, SignedOutError } from '@/lib/api';

/**
 * Settings → Data → Backups: the nightly copies in R2, newest first, each
 * to download or restore (counted and confirmed first, then merged by id
 * like an import).
 */
export function Backups() {
  const { restoreBackup } = useImportExport();
  const [list, setList] = useState<BackupList | null>(null);
  const backups = list?.backups ?? null;
  const [failed, setFailed] = useState(false);
  const today = localDate(new Date());

  useEffect(() => {
    let current = true;
    fetchBackups()
      .then((list) => {
        if (current) setList(list);
      })
      .catch((error: unknown) => {
        if (error instanceof SignedOutError) window.location.reload();
        else if (current) setFailed(true);
      });
    return () => {
      current = false;
    };
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Backups</h3>
      <p className="text-sm text-muted-foreground">
        Every night{list ? ` at ${describeSchedule(list)}` : ''}, a copy of
        everything goes to your own R2 bucket. The latest 30 are kept. Restoring
        merges a copy back in: same ids are replaced, nothing is deleted.
      </p>
      {failed ? (
        <p className="text-sm">Could not list the backups. Reload to retry.</p>
      ) : backups === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : backups.length === 0 ? (
        <p className="text-sm">No backups yet. The first one runs tonight.</p>
      ) : (
        <ul aria-label="Backups" className="flex flex-col border-t">
          {backups.map((b) => {
            const label = formatDay(b.day, today);
            return (
              <li
                key={b.day}
                className="flex min-h-11 flex-wrap items-center gap-x-3 border-b py-1 text-sm"
              >
                <span className="min-w-0 flex-1 font-medium">{label}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatBytes(b.bytes)}
                </span>
                <a
                  href={backupUrl(b.day)}
                  download={`datapad-${b.day}.json`}
                  className="press inline-flex h-11 items-center gap-1.5 px-2 text-xs hover:bg-accent desk:h-8"
                >
                  <DownloadSimpleIcon aria-hidden />
                  Download
                  <span className="sr-only"> the backup of {label}</span>
                </a>
                <Button
                  variant="ghost"
                  size="sm"
                  className="press h-11 desk:h-8"
                  onClick={() => restoreBackup(b.day, label)}
                >
                  <ArrowCounterClockwiseIcon />
                  Restore
                  <span className="sr-only"> the backup of {label}</span>
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** "3:00 AM EDT": the next run, in the backup's own zone. */
function describeSchedule({ hour, timeZone }: BackupList): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(nextDailyAt(Date.now(), timeZone, hour));
  } catch {
    return `${hour}:00 (${timeZone})`;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

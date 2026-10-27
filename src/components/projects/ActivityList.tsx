import { useEffect, useState } from 'react';
import { formatTimestamp, relativeTime } from '#shared/dates';
import type { ActivityEntry } from '#shared/types';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useClock } from '@/hooks/useClock';

/** Shown on the project page; the log keeps 150. */
export const ACTIVITY_SHOWN = 40;

/**
 * The newest entries first, each with a relative time; hovering or
 * focusing the time shows the exact one. Times refresh every minute.
 */
export function ActivityList({ entries }: { entries: ActivityEntry[] }) {
  const clock = useClock();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (entries.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">Nothing yet.</p>;
  }
  return (
    <ol aria-label="Activity" className="flex flex-col border-t">
      {entries.slice(0, ACTIVITY_SHOWN).map((entry) => (
        <li
          key={`${entry.t}|${entry.text}`}
          className="flex items-baseline gap-3 border-b py-2 text-sm"
        >
          <span className="min-w-0 flex-1">{entry.text}</span>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="shrink-0 text-xs whitespace-nowrap text-muted-foreground outline-ring/50 focus-visible:outline-2"
                />
              }
            >
              <time dateTime={entry.t}>{relativeTime(entry.t, now)}</time>
              <span className="sr-only">
                , {formatTimestamp(entry.t, clock)}
              </span>
            </TooltipTrigger>
            <TooltipContent>{formatTimestamp(entry.t, clock)}</TooltipContent>
          </Tooltip>
        </li>
      ))}
    </ol>
  );
}

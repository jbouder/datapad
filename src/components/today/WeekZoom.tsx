import {
  CheckIcon,
  CopyIcon,
  NotePencilIcon,
  SparkleIcon,
} from '@phosphor-icons/react';
import { type KeyboardEvent, useMemo, useState } from 'react';
import { type Clock, formatDay, formatTime } from '#shared/dates';
import { buildDigest, digestMarkdown, weekEnding } from '#shared/digest';
import type { WeekDay } from '#shared/today';
import { weekDayLine } from '#shared/today';
import type { Snapshot } from '#shared/types';
import { Markdown } from '@/components/Markdown';
import { useSummaries } from '@/components/summary/SummaryProvider';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { linkProps } from '@/lib/router';
import { cn } from '@/lib/utils';
import { useToast } from '@/providers/ToastProvider';

const LINK =
  'underline-offset-2 outline-ring/50 hover:underline focus-visible:outline-2';
const BUTTON = 'press h-11 desk:h-8';

/**
 * Today's week zoom (#332), which replaces the Weekly digest page: the
 * seven days from the week's first day (Settings → Today; columns on
 * desktop, rows on phones), each
 * with its meetings and its counts of due, done and notes. A day's name
 * zooms into it; arrow keys, Home and End move between the days. Under
 * them, the week's digest (`buildDigest`, the same text MCP's
 * `get_digest` returns for the week ending its Sunday), with Copy as
 * Markdown, Save as note and, with summaries on, Summarize.
 */
export function WeekZoom({
  days,
  state,
  today,
  clock,
  onPick,
}: {
  days: readonly WeekDay[];
  state: Snapshot;
  today: string;
  clock: Clock;
  onPick: (day: string) => void;
}) {
  // Arrow keys (either axis, as the days are columns or rows), Home and
  // End move between the days' buttons.
  const onKeyDown = (event: KeyboardEvent<HTMLOListElement>) => {
    const target = event.target as HTMLElement;
    if (!target.matches('[data-week-day-button]')) return;
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(
        '[data-week-day-button]',
      ),
    ];
    const i = buttons.indexOf(target);
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? i + 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? i - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    buttons[Math.max(0, Math.min(buttons.length - 1, next))]?.focus();
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <ol
        aria-label="Week"
        onKeyDown={onKeyDown}
        className="grid border-t desk:grid-cols-7 desk:border-t-0 desk:border-l"
      >
        {days.map((d) => {
          const line = weekDayLine(d);
          const isToday = d.day === today;
          // formatDay: "Mon 16 Nov", with the year when not this one.
          const [name, date, ...rest] = formatDay(d.day, today).split(' ');
          const month = rest.join(' ');
          return (
            <li
              key={d.day}
              data-week-day={d.day}
              className="flex min-w-0 gap-3 border-b py-2 desk:flex-col desk:gap-2 desk:border-r desk:border-b-0 desk:p-2"
            >
              <button
                type="button"
                data-week-day-button
                aria-current={isToday ? 'date' : undefined}
                onClick={() => onPick(d.day)}
                className={cn(
                  'press flex min-h-11 w-16 shrink-0 flex-col items-start justify-center px-1 text-left outline-ring/50 hover:bg-accent focus-visible:outline-2 desk:w-full desk:min-h-8',
                  isToday && 'text-primary',
                )}
              >
                {/* "Mon 16" on screen; read as "Mon 16 November, today". */}
                <span className="text-xs font-medium">{name}</span>{' '}
                <span className="font-heading text-lg leading-tight tabular-nums">
                  {date}
                </span>
                <span className="sr-only">
                  {` ${month}${isToday ? ', today' : ''}`}
                </span>
              </button>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                {d.meetings.length > 0 && (
                  <ul
                    aria-label={`Meetings on ${formatDay(d.day, today)}`}
                    className="flex flex-col gap-1"
                  >
                    {d.meetings.map((m) => (
                      <li
                        key={m.id}
                        data-week-meeting={m.id}
                        className="flex min-w-0 flex-col text-sm"
                      >
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {m.time ? formatTime(m.time, clock) : 'All day'}
                        </span>
                        <a
                          {...linkProps({ name: 'meeting', id: m.id })}
                          className={cn(LINK, 'break-words')}
                        >
                          {m.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {line && (
                  <p
                    data-week-counts
                    className="text-xs text-muted-foreground tabular-nums"
                  >
                    {line}
                  </p>
                )}
                {d.meetings.length === 0 && !line && (
                  <p className="text-xs text-muted-foreground">Nothing yet.</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <WeekDigest toDay={days[days.length - 1]?.day ?? today} state={state} />
    </div>
  );
}

/** The week's digest: the Markdown, with Copy, Save as note and Summarize. */
function WeekDigest({ toDay, state }: { toDay: string; state: Snapshot }) {
  const { actions } = useDatapad();
  const { summarize, enabled: summariesOn } = useSummaries();
  const { show } = useToast();
  const [copied, setCopied] = useState(false);
  const markdown = useMemo(
    () => digestMarkdown(buildDigest(state, weekEnding(toDay))),
    [state, toDay],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      show('Could not copy. Select the text instead.');
    }
  };

  const save = () => {
    const id = actions.addNote({ projectId: null, body: markdown });
    if (id) {
      show('Saved the digest as a note in General', () =>
        actions.deleteNote({ id }),
      );
    }
  };

  return (
    <section aria-labelledby="digest-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="digest-title"
          className="flex min-h-11 items-center font-heading text-sm font-semibold desk:min-h-8"
        >
          Digest
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className={BUTTON} onClick={copy}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? 'Copied' : 'Copy as Markdown'}
          </Button>
          <Button variant="outline" className={BUTTON} onClick={save}>
            <NotePencilIcon />
            Save as note
          </Button>
          {summariesOn && (
            <Button
              variant="outline"
              className={BUTTON}
              onClick={() => summarize({ kind: 'digest', toDay })}
            >
              <SparkleIcon />
              Summarize
            </Button>
          )}
        </div>
      </div>
      <div data-digest className="min-w-0 border p-4">
        <Markdown text={markdown} people={state.people} />
      </div>
    </section>
  );
}

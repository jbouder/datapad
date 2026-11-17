/**
 * Prototype: Today. One day as a timeline: meetings are the anchors, what
 * was done, added and written sits between them, a Now line moves
 * through it. Step back a day or zoom out to the week. The open loops and
 * the Loose pile sit beside it.
 */
import { useMemo, useState } from 'react';
import { addDays, formatTime, longDay } from '#shared/dates';
import { notePreview } from '#shared/notes';
import { meId } from '#shared/select';
import type { Meeting } from '#shared/types';
import { Button } from '@/components/ui/button';
import { useClock } from '@/hooks/useClock';
import { useDatapad } from '@/hooks/useDatapad';
import { useNow, useToday } from '@/hooks/useNow';
import { cn } from '@/lib/utils';
import {
  type DayEntry,
  dayEntries,
  dueOn,
  lanesOf,
  localTime,
  looseNotes,
  nextMeetingFrom,
  weekOf,
} from './model';
import {
  Chip,
  Go,
  LanesPanel,
  personName,
  SectionTitle,
  TaskList,
} from './parts';

export function Today() {
  const { state } = useDatapad();
  const today = useToday();
  const now = useNow();
  const clock = useClock();
  const [day, setDay] = useState(today);
  const [zoom, setZoom] = useState<'day' | 'week'>('day');
  const nowHHMM = localTime(new Date(now).toISOString());

  const me = state ? meId(state.people) : null;
  const lanes = useMemo(() => (state ? lanesOf(state, me) : null), [state, me]);
  if (!state || !lanes) return null;

  const entries = dayEntries(state, day);
  const due = dueOn(state, day, today);
  const loose = looseNotes(state);
  const next = nextMeetingFrom(Object.values(state.meetings), today, nowHHMM);
  const meetingsToday = entries.filter((e) => e.kind === 'meeting').length;
  const waitingCount = lanes.waiting.reduce((n, g) => n + g.tasks.length, 0);

  return (
    <div className="grid gap-8 desk:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wider">
              {day === today
                ? 'Today'
                : day < today
                  ? 'Looking back'
                  : 'Looking ahead'}
            </p>
            <h1 className="font-heading text-2xl">{longDay(day, today)}</h1>
            {day === today && (
              <p className="mt-1 text-muted-foreground text-sm">
                {meetingsToday} {meetingsToday === 1 ? 'meeting' : 'meetings'},{' '}
                {due.length} due, {waitingCount} waiting on others,{' '}
                {lanes.decide.length} to decide.
              </p>
            )}
          </div>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDay(addDays(day, zoom === 'week' ? -7 : -1))}
              aria-label={zoom === 'week' ? 'Previous week' : 'Previous day'}
            >
              ←
            </Button>
            {day !== today && (
              <Button variant="outline" size="sm" onClick={() => setDay(today)}>
                Today
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDay(addDays(day, zoom === 'week' ? 7 : 1))}
              aria-label={zoom === 'week' ? 'Next week' : 'Next day'}
            >
              →
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-pressed={zoom === 'week'}
              onClick={() => setZoom(zoom === 'week' ? 'day' : 'week')}
            >
              {zoom === 'week' ? 'Day' : 'Week'}
            </Button>
          </div>
        </header>

        {next && day === today && zoom === 'day' && (
          <NextMeeting meeting={next} today={today} />
        )}

        {zoom === 'week' ? (
          <Week
            day={day}
            today={today}
            onPick={(d) => {
              setDay(d);
              setZoom('day');
            }}
          />
        ) : (
          <>
            {due.length > 0 && (
              <section aria-label="Due" className="mb-6">
                <SectionTitle count={due.length}>
                  {day === today ? 'Due today or late' : 'Due'}
                </SectionTitle>
                <TaskList tasks={due} empty="" limit={12} />
              </section>
            )}
            <section aria-label="Timeline">
              <SectionTitle>Timeline</SectionTitle>
              <Timeline
                entries={entries}
                nowAt={day === today ? nowHHMM : null}
                clock={clock}
              />
            </section>
          </>
        )}
      </div>

      <aside className="flex flex-col gap-8">
        <Go
          to={{ name: 'loose' }}
          className="block border border-border p-3 hover:bg-muted"
        >
          <span className="font-medium text-sm">Loose</span>
          <span className="block text-muted-foreground text-sm">
            {loose.length === 0
              ? 'Nothing waiting for a home.'
              : `${loose.length} ${loose.length === 1 ? 'block' : 'blocks'} with no home yet.`}
          </span>
        </Go>
        <LanesPanel lanes={lanes} />
      </aside>
    </div>
  );
}

function NextMeeting({ meeting, today }: { meeting: Meeting; today: string }) {
  const { state } = useDatapad();
  const clock = useClock();
  if (!state) return null;
  const project = meeting.projectId ? state.projects[meeting.projectId] : null;
  const open = (meeting.topics ?? []).filter((t) => !t.done).length;
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border border-primary/50 bg-primary/5 p-4">
      <div className="min-w-0">
        <p className="text-primary text-xs uppercase tracking-wider">Next up</p>
        <p className="font-medium">{meeting.title}</p>
        <p className="text-muted-foreground text-sm">
          {meeting.date === today ? 'Today' : longDay(meeting.date, today)}
          {meeting.time && `, ${formatTime(meeting.time, clock)}`}
          {project && ` · ${project.name}`}
          {meeting.attendees.length > 0 &&
            ` · ${meeting.attendees.map((p) => personName(state, p)).join(', ')}`}
          {open > 0 && ` · ${open} ${open === 1 ? 'topic' : 'topics'}`}
        </p>
      </div>
      <Go
        to={{ name: 'meeting', id: meeting.id }}
        className="inline-flex h-11 items-center bg-primary px-4 font-medium text-primary-foreground text-sm desk:h-8"
      >
        Enter meeting
      </Go>
    </div>
  );
}

function Timeline({
  entries,
  nowAt,
  clock,
}: {
  entries: DayEntry[];
  nowAt: string | null;
  clock: ReturnType<typeof useClock>;
}) {
  const { state } = useDatapad();
  if (!state) return null;
  const rows: (DayEntry | { kind: 'now'; at: string })[] = [...entries];
  if (nowAt) {
    const i = rows.findIndex((r) => r.at > nowAt);
    rows.splice(i === -1 ? rows.length : i, 0, { kind: 'now', at: nowAt });
  }
  if (entries.length === 0) {
    return (
      <p className="py-2 text-muted-foreground text-sm">
        Nothing on this day.{nowAt ? ' Capture something below.' : ''}
      </p>
    );
  }
  return (
    <ol className="relative border-border border-l pl-4">
      {rows.map((row) => {
        if (row.kind === 'now') {
          return (
            <li
              key="now"
              className="relative -ml-4 flex items-center gap-2 py-2"
            >
              <span className="h-px flex-1 bg-primary" />
              <span className="text-primary text-xs">
                Now, {formatTime(row.at, clock)}
              </span>
            </li>
          );
        }
        const past = nowAt !== null && row.at < nowAt;
        return (
          <li
            key={`${row.kind}-${'meeting' in row ? row.meeting.id : 'task' in row ? row.task.id : row.note.id}`}
            className={cn(
              'relative py-2',
              past && row.kind === 'meeting' && 'opacity-60',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'absolute top-3.5 -left-[1.3rem] size-2 border border-background',
                row.kind === 'meeting'
                  ? 'bg-primary'
                  : 'bg-muted-foreground/50',
              )}
            />
            <div className="flex items-baseline gap-3">
              <span className="w-16 shrink-0 text-muted-foreground text-xs tabular-nums">
                {row.kind === 'meeting' && !row.meeting.time
                  ? 'All day'
                  : formatTime(row.at, clock)}
              </span>
              <div className="min-w-0 flex-1">
                <EntryBody entry={row} />
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function EntryBody({ entry }: { entry: DayEntry }) {
  const { state } = useDatapad();
  if (!state) return null;
  switch (entry.kind) {
    case 'meeting': {
      const m = entry.meeting;
      const project = m.projectId ? state.projects[m.projectId] : null;
      return (
        <Go
          to={{ name: 'meeting', id: m.id }}
          className="block hover:underline"
        >
          <span className="font-medium text-sm">{m.title}</span>
          <span className="block text-muted-foreground text-xs">
            Meeting{project ? ` · ${project.name}` : ''}
            {m.attendees.length > 0 &&
              ` · ${m.attendees.map((p) => personName(state, p)).join(', ')}`}
          </span>
        </Go>
      );
    }
    case 'done':
    case 'added': {
      const t = entry.task;
      const project = t.projectId ? state.projects[t.projectId] : null;
      return (
        <p className="text-sm">
          <span className="text-muted-foreground">
            {entry.kind === 'done' ? 'Done: ' : 'Added: '}
          </span>
          <a
            href={`/tasks/${encodeURIComponent(t.id)}`}
            className="hover:underline"
          >
            {t.title}
          </a>{' '}
          {project && <Chip>#{project.name}</Chip>}
        </p>
      );
    }
    case 'note': {
      const n = entry.note;
      const project = n.projectId ? state.projects[n.projectId] : null;
      return (
        <div className="text-sm">
          <p className="line-clamp-2">{notePreview(n.body, state.people)}</p>
          <span className="text-muted-foreground text-xs">
            Note
            {project ? (
              <>
                {' · '}
                <Go
                  to={{ name: 'project', id: project.id }}
                  className="hover:underline"
                >
                  {project.name}
                </Go>
              </>
            ) : n.meetingId ? (
              ` · ${state.meetings[n.meetingId]?.title ?? 'meeting'}`
            ) : (
              ' · Loose'
            )}
          </span>
        </div>
      );
    }
  }
}

/** The week: seven short columns, each a count and its meetings. */
function Week({
  day,
  today,
  onPick,
}: {
  day: string;
  today: string;
  onPick: (day: string) => void;
}) {
  const { state } = useDatapad();
  const clock = useClock();
  if (!state) return null;
  return (
    <ol className="grid gap-2 desk:grid-cols-7">
      {weekOf(day).map((d) => {
        const entries = dayEntries(state, d);
        const meetings = entries.filter((e) => e.kind === 'meeting');
        const done = entries.filter((e) => e.kind === 'done').length;
        const notes = entries.filter((e) => e.kind === 'note').length;
        const due = Object.values(state.tasks).filter(
          (t) => t.status === 'open' && t.due === d,
        ).length;
        return (
          <li key={d}>
            <button
              type="button"
              onClick={() => onPick(d)}
              className={cn(
                'flex h-full min-h-24 w-full flex-col gap-1 border border-border p-2 text-left hover:bg-muted',
                d === today && 'border-primary',
              )}
            >
              <span className="font-medium text-xs">{longDay(d, today)}</span>
              {meetings.map((m) =>
                m.kind === 'meeting' ? (
                  <span key={m.meeting.id} className="truncate text-xs">
                    {m.meeting.time
                      ? `${formatTime(m.meeting.time, clock)} `
                      : ''}
                    {m.meeting.title}
                  </span>
                ) : null,
              )}
              <span className="mt-auto text-muted-foreground text-[11px]">
                {[
                  due && `${due} due`,
                  done && `${done} done`,
                  notes && `${notes} ${notes === 1 ? 'note' : 'notes'}`,
                ]
                  .filter(Boolean)
                  .join(' · ') || ' '}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

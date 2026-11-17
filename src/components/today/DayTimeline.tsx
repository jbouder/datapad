import { type Clock, formatTime, formatTimeRange } from '#shared/dates';
import { inScratch, notePreview } from '#shared/notes';
import { type DayEntry, meetingPast } from '#shared/today';
import type { Note, Snapshot, TimeString } from '#shared/types';
import { useTaskPanels } from '@/components/tasks/TaskPanelProvider';
import { linkProps, type Route } from '@/lib/router';
import { cn } from '@/lib/utils';

const LINK =
  'underline-offset-2 outline-ring/50 hover:underline focus-visible:outline-2';

type Row = DayEntry | { kind: 'now'; at: TimeString };

function rowKey(row: Row): string {
  switch (row.kind) {
    case 'now':
      return 'now';
    case 'meeting':
      return `meeting-${row.meeting.id}`;
    case 'note':
      return `note-${row.note.id}`;
    default:
      return `${row.kind}-${row.task.id}`;
  }
}

/**
 * One day as a timeline (#331): meetings are the anchors (untimed ones
 * first, as All day), and what was added, done and written sits between
 * them at its time. On today, `now` draws the Now line at the current
 * minute and dims the meetings that are over. A day with nothing says so.
 */
export function DayTimeline({
  entries,
  state,
  today,
  now,
  clock,
}: {
  entries: DayEntry[];
  state: Pick<Snapshot, 'projects' | 'people' | 'meetings' | 'tasks'>;
  today: string;
  /** `HH:MM` on today; null on any other day. */
  now: TimeString | null;
  clock: Clock;
}) {
  const { openTask } = useTaskPanels();
  if (entries.length === 0) {
    return (
      <p data-timeline-empty className="text-state">
        Nothing on this day.
      </p>
    );
  }
  const rows: Row[] = [...entries];
  if (now) {
    // After everything at or before this minute; untimed meetings stay on top.
    const at = rows.findIndex((r) => r.at !== '' && r.at > now);
    rows.splice(at === -1 ? rows.length : at, 0, { kind: 'now', at: now });
  }

  const projectLink = (projectId: string | null, query?: string) => {
    const project = projectId ? state.projects[projectId] : undefined;
    return project ? (
      <a
        {...linkProps({ name: 'project', id: project.id }, query)}
        className={cn(LINK, 'inline-flex min-h-6 items-center')}
      >
        {project.name}
      </a>
    ) : null;
  };

  /** Where a note lives: its meeting, task, room, or Scratch. */
  const noteHome = (note: Note) => {
    const query = `note=${encodeURIComponent(note.id)}`;
    const meeting = note.meetingId ? state.meetings[note.meetingId] : undefined;
    if (meeting) {
      return link({ name: 'meeting', id: meeting.id }, meeting.title, query);
    }
    const task = note.taskId ? state.tasks[note.taskId] : undefined;
    if (task) {
      return (
        <button
          type="button"
          onClick={() => openTask(task.id)}
          className={cn(LINK, 'text-left')}
        >
          {task.title}
        </button>
      );
    }
    if (note.projectId) return projectLink(note.projectId, query);
    if (inScratch(note)) return link({ name: 'scratch' }, 'Scratch', query);
    return 'General';
  };

  return (
    <ol
      aria-label="Timeline"
      data-added={entries.filter((e) => e.kind === 'added').length}
      className="flex flex-col border-l"
    >
      {rows.map((row) => {
        if (row.kind === 'now') {
          return (
            <li
              key="now"
              data-now
              className="-ml-px flex items-center gap-2 border-l-2 border-primary py-1 pl-3"
            >
              <span className="text-xs font-medium text-primary tabular-nums">
                Now, {formatTime(row.at, clock)}
              </span>
              <span aria-hidden className="h-px flex-1 bg-primary" />
            </li>
          );
        }
        const past =
          row.kind === 'meeting' && now !== null
            ? meetingPast(row.meeting, today, now)
            : false;
        return (
          <li
            key={rowKey(row)}
            data-entry={row.kind}
            data-past={past || undefined}
            className="flex items-baseline gap-3 py-2 pl-3"
          >
            <span className="w-24 shrink-0 text-xs text-muted-foreground tabular-nums">
              {row.kind === 'meeting'
                ? row.meeting.time
                  ? formatTimeRange(row.meeting.time, row.meeting.end, clock)
                  : 'All day'
                : formatTime(row.at, clock)}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
              {row.kind === 'meeting' && (
                <>
                  <a
                    {...linkProps({ name: 'meeting', id: row.meeting.id })}
                    className={cn(
                      LINK,
                      'font-medium',
                      past && 'text-muted-foreground',
                    )}
                  >
                    {row.meeting.title}
                  </a>
                  <span className="text-xs text-muted-foreground">
                    Meeting{past ? ', over' : ''}
                    {row.meeting.projectId && (
                      <> · {projectLink(row.meeting.projectId)}</>
                    )}
                    {row.meeting.attendees.length > 0 &&
                      ` · ${row.meeting.attendees
                        .map((id) => state.people[id]?.name)
                        .filter(Boolean)
                        .join(', ')}`}
                  </span>
                </>
              )}
              {(row.kind === 'added' || row.kind === 'done') && (
                <>
                  <span className="min-w-0">
                    <span className="text-muted-foreground">
                      {row.kind === 'done' ? 'Done: ' : 'Added: '}
                    </span>
                    <button
                      type="button"
                      onClick={() => openTask(row.task.id)}
                      className={cn(LINK, 'text-left')}
                    >
                      {row.task.title}
                    </button>
                  </span>
                  {row.task.projectId && (
                    <span className="text-xs text-muted-foreground">
                      {projectLink(row.task.projectId)}
                    </span>
                  )}
                </>
              )}
              {row.kind === 'note' && (
                <>
                  <p className="line-clamp-2 whitespace-pre-line">
                    {notePreview(row.note.body, state.people)}
                  </p>
                  <span className="text-xs text-muted-foreground">
                    Note · {noteHome(row.note)}
                  </span>
                </>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function link(route: Route, text: string, query?: string) {
  return (
    <a {...linkProps(route, query)} className={LINK}>
      {text}
    </a>
  );
}

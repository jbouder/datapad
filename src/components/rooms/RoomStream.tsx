import {
  ArrowSquareOutIcon,
  CalendarBlankIcon,
  CheckCircleIcon,
  FlagIcon,
  PlusCircleIcon,
} from '@phosphor-icons/react';
import { useId, useMemo, useRef, useState } from 'react';
import { formatDay, formatTime, relativeTime } from '#shared/dates';
import type { StreamItem } from '#shared/stream';
import type { Snapshot, Task } from '#shared/types';
import { NoteRow } from '@/components/notes/NoteRow';
import { useTaskPanels } from '@/components/tasks/TaskPanelProvider';
import { Button } from '@/components/ui/button';
import { useClock } from '@/hooks/useClock';
import { useFlip } from '@/hooks/useFlip';
import { linkProps, type Route } from '@/lib/router';
import { cn } from '@/lib/utils';
import { useMotion } from '@/providers/MotionProvider';

/** How many items the stream shows at first, and adds per Show older. */
export const STREAM_PAGE = 30;

const META = 'text-xs text-muted-foreground';
const ROW = 'flex items-start gap-1 border bg-card pr-1 text-sm';
const TITLE_LINK =
  'flex min-h-11 items-center text-left outline-ring/50 hover:underline focus-visible:outline-2 desk:min-h-8';

/**
 * A room's stream (#334): Coming up first (meetings and milestones
 * ahead, soonest first), then everything else newest first: every note
 * open with its checkboxes saving in place, tasks once when added and
 * again when done (Open task opens its panel), meetings and
 * milestones. The first `STREAM_PAGE` show; Show
 * older pages in the rest. `milestoneRoute` is where a milestone opens
 * (the Plan tab).
 */
export function RoomStream({
  upcoming,
  items,
  state,
  today,
  empty,
  milestoneRoute,
  openAtTop = null,
}: {
  upcoming: readonly StreamItem[];
  items: readonly StreamItem[];
  state: Snapshot;
  today: string;
  empty: string;
  milestoneRoute?: (
    projectId: string,
    milestoneId: string,
  ) => {
    route: Route;
    query: string;
  };
  /**
   * The note open at the top of the room as a pinned note (#377): its
   * row here does not answer `?note=`.
   */
  openAtTop?: string | null;
}) {
  const [shown, setShown] = useState(STREAM_PAGE);
  const { active } = useMotion();
  const list = useRef<HTMLUListElement>(null);
  useFlip(list, active);
  const page = useMemo(() => items.slice(0, shown), [items, shown]);
  const more = items.length - page.length;

  return (
    <>
      {upcoming.length > 0 && (
        <section
          aria-labelledby="coming-up-title"
          className="flex flex-col gap-2"
        >
          <h3
            id="coming-up-title"
            className="flex min-h-8 items-center gap-1.5 text-xs font-medium text-muted-foreground"
          >
            Coming up
          </h3>
          <ul aria-label="Coming up" className="flex flex-col gap-2">
            {upcoming.map((item) => (
              <StreamEntry
                key={item.key}
                item={item}
                state={state}
                today={today}
                milestoneRoute={milestoneRoute}
                openAtTop={openAtTop}
              />
            ))}
          </ul>
        </section>
      )}
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
      <ul
        ref={list}
        aria-label="Stream"
        hidden={items.length === 0}
        className="flex flex-col gap-2"
      >
        {page.map((item) => (
          <StreamEntry
            key={item.key}
            item={item}
            state={state}
            today={today}
            milestoneRoute={milestoneRoute}
            openAtTop={openAtTop}
          />
        ))}
      </ul>
      {more > 0 && (
        <Button
          variant="outline"
          className="press h-11 self-start desk:h-8"
          onClick={() => setShown((n) => n + STREAM_PAGE)}
        >
          Show older
          <span className="count text-xs text-muted-foreground tabular-nums">
            {more}
          </span>
        </Button>
      )}
    </>
  );
}

function StreamEntry({
  item,
  state,
  today,
  milestoneRoute,
  openAtTop,
}: {
  item: StreamItem;
  state: Snapshot;
  today: string;
  milestoneRoute?: (
    projectId: string,
    milestoneId: string,
  ) => {
    route: Route;
    query: string;
  };
  openAtTop: string | null;
}) {
  const clock = useClock();
  switch (item.kind) {
    case 'note':
      return (
        <NoteRow
          note={item.note}
          state={state}
          chips={{ meeting: true, task: true }}
          arrive={item.note.id !== openAtTop}
        />
      );
    case 'task':
      return (
        <StreamTask
          task={item.task}
          event={item.event}
          state={state}
          today={today}
        />
      );
    case 'meeting': {
      const m = item.meeting;
      return (
        <li data-stream={item.key} className={cn(ROW, 'pl-1')}>
          <span className="flex size-11 shrink-0 items-center justify-center text-muted-foreground desk:size-8">
            <CalendarBlankIcon aria-hidden />
          </span>
          <div className="flex min-w-0 flex-1 flex-col py-1 desk:py-0.5">
            <a
              {...linkProps({ name: 'meeting', id: m.id })}
              className={TITLE_LINK}
            >
              <span className="sr-only">Meeting: </span>
              {m.title}
            </a>
            <p className={cn(META, 'pb-1')}>
              Meeting · {formatDay(m.date, today)}
              {m.time && `, ${formatTime(m.time, clock)}`}
            </p>
          </div>
        </li>
      );
    }
    case 'milestone': {
      const ms = item.milestone;
      const to = milestoneRoute?.(item.projectId, ms.id);
      return (
        <li data-stream={item.key} className={cn(ROW, 'pl-1')}>
          <span className="flex size-11 shrink-0 items-center justify-center text-muted-foreground desk:size-8">
            <FlagIcon aria-hidden />
          </span>
          <div className="flex min-w-0 flex-1 flex-col py-1 desk:py-0.5">
            {to ? (
              <a {...linkProps(to.route, to.query)} className={TITLE_LINK}>
                <span className="sr-only">Milestone: </span>
                {ms.title}
              </a>
            ) : (
              <span className="flex min-h-11 items-center desk:min-h-8">
                <span className="sr-only">Milestone: </span>
                {ms.title}
              </span>
            )}
            <p className={cn(META, 'pb-1')}>
              Milestone · {formatDay(ms.date, today)}
            </p>
          </div>
        </li>
      );
    }
  }
}

/**
 * A task in the stream: a record that it was added or done, not a second
 * copy of its loop (the lanes close and reopen it). Open task opens its
 * panel; its title describes the button, so each says which task.
 */
function StreamTask({
  task,
  event,
  state,
  today,
}: {
  task: Task;
  event: 'added' | 'done';
  state: Snapshot;
  today: string;
}) {
  const { openTask } = useTaskPanels();
  const titleId = useId();
  const at = event === 'done' ? task.completedAt : task.createdAt;
  const assignee = task.assignee ? state.people[task.assignee] : undefined;
  const done = event === 'done';
  return (
    <li data-stream={`${event}:${task.id}`} className={cn(ROW, 'pl-1')}>
      <span className="flex size-11 shrink-0 items-center justify-center text-muted-foreground desk:size-8">
        {done ? (
          <CheckCircleIcon aria-hidden className="text-ok" />
        ) : (
          <PlusCircleIcon aria-hidden />
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col py-1 desk:py-0.5">
        <p id={titleId} className="flex min-h-11 items-center desk:min-h-8">
          {task.title}
        </p>
        <p className={cn(META, 'pb-1')}>
          {done ? 'Done' : 'Task added'}
          {at && ` · ${relativeTime(at, new Date())}`}
          {assignee && !assignee.me && ` · ${assignee.name}`}
          {!done && task.due && ` · Due ${formatDay(task.due, today)}`}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="press size-11 shrink-0 desk:size-8"
        aria-describedby={titleId}
        title="Open task"
        onClick={() => openTask(task.id)}
      >
        <ArrowSquareOutIcon />
        <span className="sr-only">Open task</span>
      </Button>
    </li>
  );
}

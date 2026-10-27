import {
  ArrowBendDownRightIcon,
  ArrowSquareOutIcon,
  DotsThreeIcon,
  NotePencilIcon,
  PencilSimpleIcon,
  SparkleIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { useMemo, useRef, useState } from 'react';
import { formatDay } from '#shared/dates';
import {
  carryForward,
  nextMeeting,
  timeRange,
  topicCount,
  topicsNoun,
  topicsToCarry,
} from '#shared/meetings';
import {
  type Meeting,
  type Person,
  type Snapshot,
  topicsOf,
} from '#shared/types';
import { Initials } from '@/components/Initials';
import {
  actionItemCount,
  deleteMeetingQuestion,
} from '@/components/meetings/MeetingForm';
import { useMeetingForm } from '@/components/meetings/MeetingFormProvider';
import { MeetingNoteComposer } from '@/components/meetings/MeetingNoteComposer';
import type { InlineNoteComposerHandle } from '@/components/notes/InlineNoteComposer';
import { useSummaries } from '@/components/summary/SummaryProvider';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useClock } from '@/hooks/useClock';
import { useDatapad } from '@/hooks/useDatapad';
import { newId } from '@/lib/ids';
import { linkProps } from '@/lib/router';
import { cn } from '@/lib/utils';
import { useToast } from '@/providers/ToastProvider';

const MENU_TRIGGER =
  'press flex size-11 shrink-0 items-center justify-center outline-ring/50 hover:bg-accent focus-visible:outline-2 data-popup-open:bg-accent desk:size-8';

/**
 * One meeting: its day and times, title (goes to the meeting's page),
 * topic count, project chip, attendees, link, and the actions: Add note
 * (beside the row on desktop, in its menu everywhere), Edit (the panel),
 * Delete. Delete asks in the row first; the meeting's notes and action
 * items are kept. A
 * note is written in place, in a composer under the row (one at a time);
 * the topics and notes themselves are on the page. It lays out by its own
 * width (a container query), so it stacks in a narrow column or popover as
 * on a phone.
 */
export function MeetingRow({
  meeting,
  state,
  today,
  showProject = true,
  className,
  style,
}: {
  meeting: Meeting;
  state: Snapshot;
  today: string;
  showProject?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const clock = useClock();
  const { actions } = useDatapad();
  const { openMeeting } = useMeetingForm();
  // Whether a note is being written under the row.
  const [composing, setComposing] = useState(false);
  const composer = useRef<InlineNoteComposerHandle>(null);
  const startNote = () => {
    if (composing) composer.current?.focus();
    else setComposing(true);
  };
  const { summarize } = useSummaries();
  const { show } = useToast();
  const [confirming, setConfirming] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const project = meeting.projectId ? state.projects[meeting.projectId] : null;
  const attendees = meeting.attendees
    .map((id) => state.people[id])
    .filter((p): p is Person => Boolean(p));
  const range = timeRange(meeting, clock);
  const count = topicCount(topicsOf(meeting));
  const notes = Object.values(state.notes).filter(
    (n) => n.meetingId === meeting.id,
  ).length;
  // Carry forward: the next meeting in the series, when there are
  // uncovered topics it does not have yet.
  const next = useMemo(
    () => nextMeeting(state.meetings, meeting),
    [state.meetings, meeting],
  );
  const canCarry = next !== null && topicsToCarry(meeting, next).length > 0;

  const carry = () => {
    if (!next) return;
    const { ops, undo, count } = carryForward(meeting, next, newId);
    if (count === 0 || !actions.batch({ ops })) return;
    show(`Carried ${topicsNoun(count)} to ${formatDay(next.date, today)}`, () =>
      actions.batch({ ops: undo }),
    );
  };

  const remove = () => {
    if (!actions.deleteMeeting({ id: meeting.id })) return;
    show(`Deleted “${meeting.title}”`);
  };

  return (
    <div
      ref={row}
      tabIndex={-1}
      data-meeting-id={meeting.id}
      data-layout-id={meeting.id}
      className={cn(
        'meeting-row @container/row flex flex-col border-b outline-none',
        className,
      )}
      style={style}
    >
      <div className="flex min-h-11 items-start gap-1 py-1.5 @xl/row:items-center @xl/row:gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1 pt-1 @xl/row:flex-row @xl/row:items-center @xl/row:gap-3 @xl/row:pt-0">
          <span className="flex shrink-0 items-baseline gap-2 text-xs text-muted-foreground tabular-nums @xl/row:w-40">
            <span className="text-foreground">
              {formatDay(meeting.date, today)}
            </span>
            {range && <span>{range}</span>}
          </span>
          <span className="flex min-w-0 items-center gap-2 @xl/row:flex-1 @xl/row:gap-3">
            <a
              {...linkProps({ name: 'meeting', id: meeting.id })}
              className="min-w-0 text-left text-sm font-medium underline-offset-4 outline-ring/50 hover:underline focus-visible:outline-2 @xl/row:flex-1 @xl/row:truncate"
            >
              {meeting.title}
            </a>
          </span>
          {(showProject || attendees.length > 0 || count) && (
            <span className="flex min-w-0 flex-wrap items-center gap-2 @xl/row:shrink-0 @xl/row:flex-nowrap">
              {count && (
                <span
                  data-topic-count
                  className="count text-xs whitespace-nowrap text-muted-foreground tabular-nums"
                >
                  {count}
                </span>
              )}
              {showProject &&
                (project ? (
                  <a
                    {...linkProps({ name: 'project', id: project.id })}
                    className="max-w-48 truncate border px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground desk:max-w-40"
                  >
                    {project.name}
                    {project.archived && (
                      <span className="sr-only"> (archived)</span>
                    )}
                  </a>
                ) : (
                  <span className="border px-1.5 py-0.5 text-xs text-muted-foreground">
                    General
                  </span>
                ))}
              {attendees.length > 0 && (
                <span className="flex gap-0.5">
                  <span className="sr-only">Attendees: </span>
                  {attendees.map((p) => (
                    <Initials key={p.id} person={p} />
                  ))}
                </span>
              )}
            </span>
          )}
        </div>
        {meeting.link && (
          <a
            href={meeting.link}
            target="_blank"
            rel="noopener noreferrer"
            className="press flex size-11 shrink-0 items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground desk:size-8"
          >
            <ArrowSquareOutIcon aria-hidden />
            <span className="sr-only">
              Link for “{meeting.title}” (opens in a new tab)
            </span>
          </a>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="press hidden h-8 shrink-0 px-2 text-xs @xl/row:inline-flex"
          onClick={startNote}
        >
          <NotePencilIcon />
          Add note
          <span className="sr-only"> to “{meeting.title}”</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            className={MENU_TRIGGER}
            aria-label={`More for “${meeting.title}”`}
          >
            <DotsThreeIcon weight="bold" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem
              onClick={() => summarize({ kind: 'meeting', id: meeting.id })}
            >
              <SparkleIcon />
              Summarize
            </DropdownMenuItem>
            <DropdownMenuItem onClick={startNote}>
              <NotePencilIcon />
              Add note
            </DropdownMenuItem>
            {canCarry && (
              <DropdownMenuItem onClick={carry}>
                <ArrowBendDownRightIcon />
                Carry forward
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => openMeeting(meeting.id)}>
              <PencilSimpleIcon />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setConfirming(true)}
            >
              <TrashIcon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {meeting.note && (
        <p className="pb-2 text-xs whitespace-pre-line text-muted-foreground @xl/row:pl-43">
          {meeting.note}
        </p>
      )}
      {composing && (
        <MeetingNoteComposer
          ref={composer}
          meeting={meeting}
          people={state.people}
          onDone={(noteId) => {
            setComposing(false);
            row.current?.focus({ preventScroll: true });
            if (noteId) show(`Added a note to “${meeting.title}”`);
          }}
          className="pb-2 @xl/row:pl-43"
        />
      )}
      {confirming && (
        <div
          role="alertdialog"
          aria-labelledby={`delete-${meeting.id}`}
          className="flex flex-wrap items-center gap-2 bg-muted px-2 py-2"
        >
          <p id={`delete-${meeting.id}`} className="flex-1 text-sm">
            {deleteMeetingQuestion(
              meeting.title,
              notes,
              actionItemCount(state.tasks, meeting.id),
            )}
          </p>
          <Button
            type="button"
            variant="outline"
            className="press h-11 desk:h-8"
            autoFocus
            onClick={() => setConfirming(false)}
          >
            Keep it
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="press h-11 desk:h-8"
            onClick={remove}
          >
            Delete meeting
          </Button>
        </div>
      )}
    </div>
  );
}

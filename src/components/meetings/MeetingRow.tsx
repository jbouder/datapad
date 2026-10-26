import {
  ArrowSquareOutIcon,
  ClipboardTextIcon,
  DotsThreeIcon,
  NotePencilIcon,
  PencilSimpleIcon,
  SparkleIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { formatDay } from '#shared/dates';
import { timeRange } from '#shared/meetings';
import type { Meeting, Person, Snapshot } from '#shared/types';
import { Initials } from '@/components/Initials';
import { LinkedNotes } from '@/components/meetings/LinkedNotes';
import { deleteMeetingQuestion } from '@/components/meetings/MeetingForm';
import { useMeetingForm } from '@/components/meetings/MeetingFormProvider';
import { useMeetingNotes } from '@/components/meetings/MeetingNotesProvider';
import { useSummaries } from '@/components/summary/SummaryProvider';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDatapad } from '@/hooks/useDatapad';
import { linkProps, useQuery } from '@/lib/router';
import { cn } from '@/lib/utils';
import { useToast } from '@/providers/ToastProvider';

const MENU_TRIGGER =
  'press flex size-11 shrink-0 items-center justify-center outline-ring/50 hover:bg-accent focus-visible:outline-2 data-popup-open:bg-accent desk:size-8';

/**
 * One meeting: its day and times, title (opens the form),
 * project chip, attendees, link, and the actions: Prep note and Debrief
 * note (beside the row on desktop, in its menu everywhere), Edit, Delete.
 * Delete asks in the row first; the meeting's notes are kept. Its linked
 * notes follow underneath. It lays out by its own width (a container
 * query), so it stacks in a narrow column or popover as on a phone.
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
  const { actions } = useDatapad();
  const { openMeeting } = useMeetingForm();
  const { startNote } = useMeetingNotes();
  const { summarize } = useSummaries();
  const { show } = useToast();
  const [confirming, setConfirming] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const target = useQuery().get('meeting');
  const [flash, setFlash] = useState(false);

  // Arriving from Focus's agenda or search: bring the row into view.
  useEffect(() => {
    if (target !== meeting.id || !row.current) return;
    row.current.scrollIntoView({ block: 'center' });
    row.current.focus({ preventScroll: true });
    setFlash(true);
    const timer = window.setTimeout(() => setFlash(false), 2400);
    return () => window.clearTimeout(timer);
  }, [target, meeting.id]);
  const project = meeting.projectId ? state.projects[meeting.projectId] : null;
  const attendees = meeting.attendees
    .map((id) => state.people[id])
    .filter((p): p is Person => Boolean(p));
  const range = timeRange(meeting);
  const notes = Object.values(state.notes).filter(
    (n) => n.meetingId === meeting.id,
  ).length;

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
      data-highlighted={flash || undefined}
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
            <button
              type="button"
              onClick={() => openMeeting(meeting.id)}
              className="min-w-0 text-left text-sm font-medium underline-offset-4 outline-ring/50 hover:underline focus-visible:outline-2 @xl/row:flex-1 @xl/row:truncate"
            >
              {meeting.title}
            </button>
          </span>
          {(showProject || attendees.length > 0) && (
            <span className="flex min-w-0 flex-wrap items-center gap-2 @xl/row:shrink-0 @xl/row:flex-nowrap">
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
        <span className="hidden shrink-0 @xl/row:flex">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="press h-8 px-2 text-xs"
            onClick={() => startNote(meeting, 'pre')}
          >
            Prep
            <span className="sr-only"> note for “{meeting.title}”</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="press h-8 px-2 text-xs"
            onClick={() => startNote(meeting, 'post')}
          >
            Debrief
            <span className="sr-only"> note for “{meeting.title}”</span>
          </Button>
        </span>
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
            <DropdownMenuItem onClick={() => startNote(meeting, 'pre')}>
              <ClipboardTextIcon />
              Prep note
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => startNote(meeting, 'post')}>
              <NotePencilIcon />
              Debrief note
            </DropdownMenuItem>
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
      <LinkedNotes meeting={meeting} state={state} />
      {confirming && (
        <div
          role="alertdialog"
          aria-labelledby={`delete-${meeting.id}`}
          className="flex flex-wrap items-center gap-2 bg-muted px-2 py-2"
        >
          <p id={`delete-${meeting.id}`} className="flex-1 text-sm">
            {deleteMeetingQuestion(meeting.title, notes)}
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

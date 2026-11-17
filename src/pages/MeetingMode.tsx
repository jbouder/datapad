import {
  ArrowBendDownRightIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  SignOutIcon,
  SparkleIcon,
  TrashIcon,
  VideoCameraIcon,
} from '@phosphor-icons/react';
import { useEffect, useId, useMemo, useState } from 'react';
import { formatDay, longDay } from '#shared/dates';
import {
  carryForward,
  meetingPhase,
  nextMeeting,
  PHASE_LABEL,
  previousMeeting,
  timeRange,
  topicsNoun,
  topicsToCarry,
} from '#shared/meetings';
import { notesOfMeeting } from '#shared/select';
import type { Meeting, Note, Person, Snapshot } from '#shared/types';
import { DetailActions } from '@/components/DetailActions';
import { ExternalLink } from '@/components/ExternalLink';
import { MeetingActionItems } from '@/components/meetings/MeetingActionItems';
import {
  actionItemCount,
  deleteMeetingQuestion,
} from '@/components/meetings/MeetingForm';
import { useMeetingForm } from '@/components/meetings/MeetingFormProvider';
import { MeetingLoops } from '@/components/meetings/MeetingLoops';
import {
  meetingDraftKey,
  meetingNoteLabel,
} from '@/components/meetings/MeetingNoteComposer';
import { MeetingTopics } from '@/components/meetings/MeetingTopics';
import { InlineNoteComposer } from '@/components/notes/InlineNoteComposer';
import { NoteRow } from '@/components/notes/NoteRow';
import { useNotes } from '@/components/notes/NotesProvider';
import { SyncStatus } from '@/components/SyncStatus';
import { useSummaries } from '@/components/summary/SummaryProvider';
import { Button } from '@/components/ui/button';
import { useClock } from '@/hooks/useClock';
import { useDatapad } from '@/hooks/useDatapad';
import { useNow, useToday } from '@/hooks/useNow';
import { usePageTitle } from '@/hooks/usePageTitle';
import { newId } from '@/lib/ids';
import { leaveMeeting, linkProps } from '@/lib/router';
import { shortcutAllowed } from '@/lib/shortcuts';
import { cn } from '@/lib/utils';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { usePageSections, usePageSetting } from '@/providers/PagePrefsProvider';
import { useToast } from '@/providers/ToastProvider';

/** A header control: 44px to a finger. */
const HEADER_BUTTON =
  'press inline-flex h-11 items-center gap-1.5 border px-3 text-sm outline-ring/50 hover:bg-accent focus-visible:outline-2 desk:h-8';
/** A link in the header's lines: 44px to a finger, 24px with a mouse. */
const HEADER_LINK =
  'inline-flex min-h-11 items-center underline-offset-4 outline-ring/50 hover:text-foreground hover:underline focus-visible:outline-2 desk:min-h-6';

/** `HH:MM` in the device's zone. */
function clockTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Meeting mode (`/meetings/:id`, #336): one meeting, full screen, the
 * same before it (Prep), while it runs (Live) and after it (Debrief).
 *
 * The header has the phase, the title, the day and time, its room and
 * attendees (each a link to their room), Join, Previous and Next in the
 * series, Edit (the meeting form) with More (Summarize, Carry forward to
 * the next one, Delete, which asks first and keeps the notes and action
 * items), and Leave, which goes back to where meeting mode was entered
 * from, or to Today. Esc does the same, when nothing else wants it.
 *
 * Below, the agenda on the left (the meeting's own text, its topics, and
 * Carry forward from the last meeting of the series), the notes in the
 * middle (the composer, always open, then each saved note) with the
 * action items under them, and the open loops on the right: a 1:1's
 * other person's, otherwise the meeting's project's, otherwise none. On
 * a phone they stack in that order. Settings → Pages can hide topics,
 * notes, action items or the series, and covered topics and done action
 * items (#313).
 */
export function MeetingMode({ id }: { id: string }) {
  const clock = useClock();
  const { state, actions } = useDatapad();
  const { openMeeting } = useMeetingForm();
  const { summarize, enabled: summariesOn } = useSummaries();
  const { show } = useToast();
  const today = useToday();
  const now = clockTime(useNow());
  const meeting = state?.meetings[id];
  usePageTitle(meeting?.title ?? (state ? 'Not found' : 'Meeting'));
  const [confirming, setConfirming] = useState(false);
  const sections = usePageSections('meeting');
  const hideCovered = usePageSetting('meeting', 'covered') === 'hide';
  const hideDoneActions = usePageSetting('meeting', 'doneActions') === 'hide';
  /** Deleted just now: on the way out. */
  const [leaving, setLeaving] = useState(false);
  useLeaveKey();

  const meetings = state?.meetings;
  const series = useMemo(
    () =>
      meeting && meetings
        ? {
            previous: previousMeeting(meetings, meeting),
            next: nextMeeting(meetings, meeting),
          }
        : { previous: null, next: null },
    [meetings, meeting],
  );
  const stateNotes = state?.notes;
  const notes = useMemo(
    () => (stateNotes ? notesOfMeeting(stateNotes, id) : []),
    [stateNotes, id],
  );

  if (!state) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!meeting && leaving) return null;
  if (!meeting) return <NotFoundPage what="meeting" />;

  const project = meeting.projectId ? state.projects[meeting.projectId] : null;
  const attendees = meeting.attendees
    .map((p) => state.people[p])
    .filter((p): p is Person => Boolean(p));
  const range = timeRange(meeting, clock);
  const phase = meetingPhase(meeting, today, now);
  const { previous, next } = series;
  const canCarryOn = next !== null && topicsToCarry(meeting, next).length > 0;
  const toBring = previous ? topicsToCarry(previous, meeting).length : 0;
  const visible = new Set(sections.visible);

  const carry = (from: Meeting, to: Meeting) => {
    const { ops, undo, count } = carryForward(from, to, newId);
    if (count === 0 || !actions.batch({ ops })) return;
    const where =
      to.id === meeting.id
        ? `from ${formatDay(from.date, today)}`
        : `to ${formatDay(to.date, today)}`;
    show(`Carried ${topicsNoun(count)} ${where}`, () =>
      actions.batch({ ops: undo }),
    );
  };

  const remove = () => {
    setLeaving(true);
    if (!actions.deleteMeeting({ id: meeting.id })) {
      setLeaving(false);
      return;
    }
    leaveMeeting({ replace: true });
    show(`Deleted “${meeting.title}”`);
  };

  return (
    <article
      aria-labelledby="meeting-page-title"
      data-phase={phase}
      className="enter flex flex-col gap-6"
    >
      <header className="flex flex-col gap-2 border-b pb-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium tracking-wider text-primary uppercase">
            {PHASE_LABEL[phase]}
          </p>
          {/* No rail or top bar here: whether changes are saved shows here. */}
          <SyncStatus className="min-h-11 desk:min-h-6" />
        </div>
        <div className="flex flex-wrap items-start gap-3">
          <h1
            id="meeting-page-title"
            className="text-page-title min-w-0 flex-1 basis-full desk:basis-0"
          >
            {meeting.title}
          </h1>
          <div className="flex flex-wrap gap-1">
            {meeting.link && (
              <ExternalLink
                url={meeting.link}
                icon={false}
                className={cn(
                  HEADER_BUTTON,
                  'bg-primary text-primary-foreground hover:bg-primary/85',
                )}
              >
                <VideoCameraIcon aria-hidden />
                Join
              </ExternalLink>
            )}
            <DetailActions
              onEdit={() => openMeeting(meeting.id)}
              menu={[
                {
                  label: 'Summarize',
                  icon: <SparkleIcon />,
                  onSelect: () =>
                    summarize({ kind: 'meeting', id: meeting.id }),
                  hidden: !summariesOn,
                },
                {
                  label: 'Carry forward',
                  icon: <ArrowBendDownRightIcon />,
                  onSelect: () => next && carry(meeting, next),
                  hidden: !canCarryOn,
                },
                {
                  label: 'Delete',
                  icon: <TrashIcon />,
                  onSelect: () => setConfirming(true),
                  destructive: true,
                },
              ]}
            />
            <Button
              type="button"
              variant="outline"
              className="press h-11 desk:h-8"
              aria-keyshortcuts="Escape"
              onClick={() => leaveMeeting()}
            >
              <SignOutIcon />
              Leave
              <kbd className="text-xs text-muted-foreground hover-none:hidden">
                Esc
              </kbd>
            </Button>
          </div>
        </div>
        {confirming && (
          <div
            role="alertdialog"
            aria-labelledby="meeting-page-delete"
            className="flex flex-wrap items-center gap-2 bg-muted px-2 py-2"
          >
            <p id="meeting-page-delete" className="flex-1 text-sm">
              {deleteMeetingQuestion(
                meeting.title,
                notes.length,
                actionItemCount(state.tasks, meeting.id),
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              className="press h-11 desk:h-8"
              autoFocus
              onClick={() => setConfirming(false)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setConfirming(false);
              }}
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
        <ul
          aria-label="Details"
          className="flex flex-wrap items-center gap-x-4 text-sm text-muted-foreground"
        >
          <li className="inline-flex min-h-11 items-center tabular-nums desk:min-h-6">
            <span>
              <span className="text-foreground">
                {longDay(meeting.date, today)}
              </span>
              {range && ` · ${range}`}
            </span>
          </li>
          <li>
            {project ? (
              <a
                {...linkProps({ name: 'project', id: project.id })}
                className={HEADER_LINK}
              >
                {project.name}
                {project.archived && ' (archived)'}
              </a>
            ) : (
              <span className="inline-flex min-h-11 items-center desk:min-h-6">
                General
              </span>
            )}
          </li>
          {attendees.length > 0 && (
            <li className="flex flex-wrap items-center gap-x-3">
              <span className="sr-only">Attendees: </span>
              {attendees.map((p) => (
                <a
                  key={p.id}
                  {...linkProps({ name: 'person', id: p.id })}
                  className={HEADER_LINK}
                >
                  {p.name}
                </a>
              ))}
            </li>
          )}
        </ul>
        {visible.has('series') && (previous || next) && (
          <nav
            aria-label="This series"
            className="flex flex-wrap gap-x-4 text-sm"
          >
            {previous && (
              <SeriesLink meeting={previous} today={today} previous />
            )}
            {next && <SeriesLink meeting={next} today={today} />}
          </nav>
        )}
      </header>

      <div className="grid grid-cols-1 gap-8 desk:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)] xl:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)_minmax(16rem,20rem)]">
        <div className="flex min-w-0 flex-col gap-4 desk:row-span-2 xl:row-span-1">
          {meeting.note && (
            <section aria-labelledby="meeting-page-agenda">
              <h2 id="meeting-page-agenda" className="sr-only">
                Agenda
              </h2>
              <p className="text-sm whitespace-pre-line">{meeting.note}</p>
            </section>
          )}
          {visible.has('topics') && (
            <MeetingTopics
              meeting={meeting}
              headingLevel={2}
              hideCovered={hideCovered}
            />
          )}
          {previous && toBring > 0 && (
            <Button
              type="button"
              variant="outline"
              className="press h-11 self-start desk:h-8"
              onClick={() => carry(previous, meeting)}
            >
              <ArrowBendDownRightIcon />
              Carry forward {topicsNoun(toBring)} from{' '}
              {formatDay(previous.date, today)}
            </Button>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-8">
          {visible.has('notes') && (
            <MeetingNotes meeting={meeting} notes={notes} state={state} />
          )}
          {visible.has('actions') && (
            <MeetingActionItems
              meeting={meeting}
              headingLevel={2}
              hideDone={hideDoneActions}
            />
          )}
        </div>
        <MeetingLoops meeting={meeting} state={state} today={today} />
      </div>
    </article>
  );
}

/**
 * Esc leaves meeting mode, as Leave does, when nothing else wants it: not
 * while typing, and not with a panel, dialog or menu open. It listens
 * ahead of them (capture), so a menu that Esc closes still counts as
 * open.
 */
function useLeaveKey() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.shiftKey) return;
      if (!shortcutAllowed(event)) return;
      event.preventDefault();
      leaveMeeting();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

/**
 * The meeting's notes: the composer, always open (Save note or ⌘Enter;
 * `/task` makes an action item), then each saved note, newest first,
 * as the compact note row (its menu has Make task, which also makes an
 * action item, #336).
 */
function MeetingNotes({
  meeting,
  notes: all,
  state,
}: {
  meeting: Meeting;
  notes: Note[];
  state: Snapshot;
}) {
  const { hidden } = useNotes();
  const notes = all.filter((n) => !hidden.has(n.id));
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <span className="flex items-baseline gap-2">
        <h2 id={headingId} className="text-xs font-medium">
          Notes
        </h2>
        {notes.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {notes.length}
          </span>
        )}
      </span>
      <InlineNoteComposer
        persistent
        fields={{ projectId: meeting.projectId, meetingId: meeting.id }}
        people={state.people}
        label={meetingNoteLabel(meeting)}
        draftKey={meetingDraftKey(meeting)}
        onDone={() => undefined}
      />
      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes yet</p>
      ) : (
        <ul aria-labelledby={headingId} className="flex flex-col gap-2">
          {notes.map((n) => (
            <NoteRow key={n.id} note={n} state={state} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The previous or next meeting of the series, by its day. */
function SeriesLink({
  meeting,
  today,
  previous = false,
}: {
  meeting: Meeting;
  today: string;
  previous?: boolean;
}) {
  return (
    <a
      {...linkProps({ name: 'meeting', id: meeting.id })}
      rel={previous ? 'prev' : 'next'}
      className={cn(HEADER_LINK, 'gap-1.5 text-muted-foreground')}
    >
      {previous && <ArrowLeftIcon aria-hidden />}
      {previous ? 'Previous' : 'Next'}: {formatDay(meeting.date, today)}
      {!previous && <ArrowRightIcon aria-hidden />}
    </a>
  );
}

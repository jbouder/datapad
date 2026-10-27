import {
  ArrowBendDownRightIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowSquareOutIcon,
  PencilSimpleIcon,
  SparkleIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { formatDay } from '#shared/dates';
import {
  carryForward,
  nextMeeting,
  previousMeeting,
  timeRange,
  topicsNoun,
  topicsToCarry,
} from '#shared/meetings';
import { notesOfMeeting } from '#shared/select';
import type { Meeting, Person } from '#shared/types';
import { Initials } from '@/components/Initials';
import { deleteMeetingQuestion } from '@/components/meetings/MeetingForm';
import { useMeetingForm } from '@/components/meetings/MeetingFormProvider';
import {
  meetingDraftKey,
  meetingNoteLabel,
} from '@/components/meetings/MeetingNoteComposer';
import { MeetingTopics } from '@/components/meetings/MeetingTopics';
import { LinkedNoteList } from '@/components/notes/LinkedNoteList';
import { useSummaries } from '@/components/summary/SummaryProvider';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { useToday } from '@/hooks/useNow';
import { usePageTitle } from '@/hooks/usePageTitle';
import { newId } from '@/lib/ids';
import { linkProps, navigate } from '@/lib/router';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { useToast } from '@/providers/ToastProvider';

/**
 * One meeting, where it is run: the header with its project, day and
 * time, attendees, link and actions (Summarize, Edit in the panel, Carry
 * forward, Delete, which asks first and keeps the notes), the agenda,
 * then Topics on the left and Notes on the right (one column below
 * 820px), and the previous and next meeting of its series at the foot.
 */
export function MeetingPage({ id }: { id: string }) {
  const { state, actions } = useDatapad();
  const { openMeeting } = useMeetingForm();
  const { summarize } = useSummaries();
  const { show } = useToast();
  const today = useToday();
  const meeting = state?.meetings[id];
  usePageTitle(meeting?.title ?? (state ? 'Not found' : 'Meeting'));
  const [confirming, setConfirming] = useState(false);
  /** Deleted just now: on the way to Meetings. */
  const [leaving, setLeaving] = useState(false);

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
  const notes = useMemo(
    () => (state ? notesOfMeeting(state.notes, id) : []),
    [state, id],
  );

  if (!state) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!meeting && leaving) return null;
  if (!meeting) {
    return (
      <NotFoundPage
        what="meeting"
        back={{ name: 'meetings' }}
        backLabel="Back to Meetings"
      />
    );
  }

  const project = meeting.projectId ? state.projects[meeting.projectId] : null;
  const attendees = meeting.attendees
    .map((p) => state.people[p])
    .filter((p): p is Person => Boolean(p));
  const range = timeRange(meeting);
  const { next } = series;
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
    setLeaving(true);
    if (!actions.deleteMeeting({ id: meeting.id })) {
      setLeaving(false);
      return;
    }
    navigate({ name: 'meetings' }, { replace: true });
    show(`Deleted “${meeting.title}”`);
  };

  return (
    <article
      aria-labelledby="meeting-page-title"
      className="enter flex flex-col gap-6"
    >
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          {project ? (
            <a
              {...linkProps({ name: 'project', id: project.id })}
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              {project.name}
              {project.archived && ' (archived)'}
            </a>
          ) : (
            'General'
          )}
        </p>
        <div className="flex flex-wrap items-start gap-3">
          <h1
            id="meeting-page-title"
            className="text-page-title min-w-0 flex-1 basis-full desk:basis-0"
          >
            {meeting.title}
          </h1>
          <div className="flex flex-wrap gap-1">
            <Button
              variant="outline"
              className="press"
              onClick={() => summarize({ kind: 'meeting', id: meeting.id })}
            >
              <SparkleIcon />
              Summarize
            </Button>
            <Button
              variant="outline"
              className="press"
              onClick={() => openMeeting(meeting.id)}
            >
              <PencilSimpleIcon />
              Edit
            </Button>
            {canCarry && (
              <Button variant="outline" className="press" onClick={carry}>
                <ArrowBendDownRightIcon />
                Carry forward
              </Button>
            )}
            <Button
              variant="outline"
              className="press text-destructive"
              onClick={() => setConfirming(true)}
            >
              <TrashIcon />
              Delete
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
              {deleteMeetingQuestion(meeting.title, notes.length)}
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
        <ul
          aria-label="Details"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground"
        >
          <li className="tabular-nums">
            <span className="text-foreground">
              {formatDay(meeting.date, today)}
            </span>
            {range && <> · {range}</>}
          </li>
          {attendees.length > 0 && (
            <li className="flex items-center gap-0.5">
              <span className="sr-only">Attendees: </span>
              {attendees.map((p) => (
                <Initials key={p.id} person={p} />
              ))}
            </li>
          )}
          {meeting.link && (
            <li>
              <a
                href={meeting.link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-1 underline underline-offset-4 hover:text-foreground desk:min-h-0"
              >
                Join or open
                <ArrowSquareOutIcon aria-hidden />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          )}
        </ul>
        {meeting.note && (
          <section
            aria-labelledby="meeting-page-agenda"
            className="max-w-prose pt-2"
          >
            <h2 id="meeting-page-agenda" className="sr-only">
              Agenda
            </h2>
            <p className="text-sm whitespace-pre-line">{meeting.note}</p>
          </section>
        )}
      </header>

      <div className="grid grid-cols-1 gap-6 desk:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <MeetingTopics meeting={meeting} headingLevel={2} />
        <LinkedNoteList
          notes={notes}
          fields={{ projectId: meeting.projectId, meetingId: meeting.id }}
          people={state.people}
          label={meetingNoteLabel(meeting)}
          draftKey={meetingDraftKey(meeting)}
          headingLevel={2}
        />
      </div>

      {(series.previous || series.next) && (
        <nav
          aria-label="This series"
          className="flex flex-wrap justify-between gap-2 border-t pt-3 text-sm"
        >
          {series.previous ? (
            <SeriesLink meeting={series.previous} today={today} previous />
          ) : (
            <span />
          )}
          {series.next && <SeriesLink meeting={series.next} today={today} />}
        </nav>
      )}
    </article>
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
      className="press inline-flex min-h-11 items-center gap-1.5 px-1 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline desk:min-h-8"
    >
      {previous && <ArrowLeftIcon aria-hidden />}
      {previous ? 'Previous' : 'Next'}: {formatDay(meeting.date, today)}
      {!previous && <ArrowRightIcon aria-hidden />}
    </a>
  );
}

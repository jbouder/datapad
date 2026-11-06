import {
  ArrowBendDownRightIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  SparkleIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { Fragment, type ReactNode, useMemo, useState } from 'react';
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
import { DetailActions } from '@/components/DetailActions';
import { ExternalLink } from '@/components/ExternalLink';
import { Initials } from '@/components/Initials';
import { MeetingActionItems } from '@/components/meetings/MeetingActionItems';
import {
  actionItemCount,
  deleteMeetingQuestion,
} from '@/components/meetings/MeetingForm';
import { useMeetingForm } from '@/components/meetings/MeetingFormProvider';
import {
  meetingDraftKey,
  meetingNoteLabel,
} from '@/components/meetings/MeetingNoteComposer';
import { MeetingTopics } from '@/components/meetings/MeetingTopics';
import { LinkedNoteList } from '@/components/notes/LinkedNoteList';
import { useSummaries } from '@/components/summary/SummaryProvider';
import { Button } from '@/components/ui/button';
import { useClock } from '@/hooks/useClock';
import { useDatapad } from '@/hooks/useDatapad';
import { useToday } from '@/hooks/useNow';
import { usePageTitle } from '@/hooks/usePageTitle';
import { newId } from '@/lib/ids';
import { linkProps, navigate } from '@/lib/router';
import { cn } from '@/lib/utils';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { usePageSections, usePageSetting } from '@/providers/PagePrefsProvider';
import { useToast } from '@/providers/ToastProvider';

/**
 * One meeting, where it is run: the header with its project, day and
 * time, attendees, link and actions (Edit in the panel; under More,
 * Summarize, Carry forward and Delete, which asks first and keeps the
 * notes and action items), the agenda, then Topics and Action items on the left and Notes
 * on the right (one column below 820px), and the previous and next
 * meeting of its series at the foot. Settings → Pages can hide and
 * reorder those sections and hide covered topics and done action items
 * (#313).
 */
export function MeetingPage({ id }: { id: string }) {
  const clock = useClock();
  const { state, actions } = useDatapad();
  const { openMeeting } = useMeetingForm();
  const { summarize, enabled: summariesOn } = useSummaries();
  const { show } = useToast();
  const today = useToday();
  const meeting = state?.meetings[id];
  usePageTitle(meeting?.title ?? (state ? 'Not found' : 'Meeting'));
  const [confirming, setConfirming] = useState(false);
  // Set in Settings → Pages (#313); the meeting's panel shows everything.
  const sections = usePageSections('meeting');
  const hideCovered = usePageSetting('meeting', 'covered') === 'hide';
  const hideDoneActions = usePageSetting('meeting', 'doneActions') === 'hide';
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
  const range = timeRange(meeting, clock);
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
          <DetailActions
            onEdit={() => openMeeting(meeting.id)}
            menu={[
              {
                label: 'Summarize',
                icon: <SparkleIcon />,
                onSelect: () => summarize({ kind: 'meeting', id: meeting.id }),
                hidden: !summariesOn,
              },
              {
                label: 'Carry forward',
                icon: <ArrowBendDownRightIcon />,
                onSelect: carry,
                hidden: !canCarry,
              },
              {
                label: 'Delete',
                icon: <TrashIcon />,
                onSelect: () => setConfirming(true),
                destructive: true,
              },
            ]}
          />
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
              <ExternalLink
                url={meeting.link}
                className="inline-flex min-h-11 items-center gap-1 underline underline-offset-4 hover:text-foreground desk:min-h-0"
              >
                Join or open
              </ExternalLink>
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

      <MeetingSections
        visible={sections.visible}
        sections={{
          topics: (
            <MeetingTopics
              meeting={meeting}
              headingLevel={2}
              hideCovered={hideCovered}
            />
          ),
          actions: (
            <MeetingActionItems
              meeting={meeting}
              headingLevel={2}
              hideDone={hideDoneActions}
            />
          ),
          notes: (
            <LinkedNoteList
              notes={notes}
              fields={{ projectId: meeting.projectId, meetingId: meeting.id }}
              state={state}
              label={meetingNoteLabel(meeting)}
              draftKey={meetingDraftKey(meeting)}
              headingLevel={2}
            />
          ),
          series: (series.previous || series.next) && (
            <nav
              aria-label="This series"
              className="flex flex-wrap justify-between gap-2 border-t pt-3 text-sm"
            >
              {series.previous ? (
                <SeriesLink meeting={series.previous} today={today} previous />
              ) : (
                <span />
              )}
              {series.next && (
                <SeriesLink meeting={series.next} today={today} />
              )}
            </nav>
          ),
        }}
      />
    </article>
  );
}

/**
 * The meeting page's sections in the saved order, without the hidden
 * ones (#313). Below 820px they are one column in that order. From
 * 820px Notes keeps the right column and the rest stack on the left in
 * that order; the ones before Notes start beside it and the ones after
 * follow them, so the reading order is the saved order at every width.
 * Series, when it comes last, is the full-width foot it always was.
 */
function MeetingSections({
  visible,
  sections,
}: {
  visible: readonly string[];
  sections: Record<string, ReactNode>;
}) {
  const shown = visible.filter((key) => sections[key]);
  const foot = shown[shown.length - 1] === 'series' ? 'series' : null;
  const body = foot ? shown.slice(0, -1) : shown;
  const notesAt = body.indexOf('notes');
  const before = notesAt < 0 ? body : body.slice(0, notesAt);
  const after = notesAt < 0 ? [] : body.slice(notesAt + 1);
  // Notes beside one group on the left, or two when it sits between them.
  const split = before.length > 0 && after.length > 0;
  const column = (keys: string[], className?: string) =>
    keys.length > 0 && (
      <div className={cn('flex min-w-0 flex-col gap-6', className)}>
        {keys.map((key) => (
          <Fragment key={key}>{sections[key]}</Fragment>
        ))}
      </div>
    );
  return (
    <>
      {body.length > 0 && (
        <div
          className={cn(
            'grid grid-cols-1 gap-6 desk:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]',
            split && 'desk:grid-rows-[auto_1fr]',
          )}
        >
          {column(before, 'desk:col-start-1 desk:row-start-1')}
          {notesAt >= 0 && (
            <div
              className={cn(
                'min-w-0 desk:col-start-2 desk:row-start-1',
                split && 'desk:row-span-2',
              )}
            >
              {sections.notes}
            </div>
          )}
          {column(
            after,
            cn(
              'desk:col-start-1',
              split ? 'desk:row-start-2' : 'desk:row-start-1',
            ),
          )}
        </div>
      )}
      {foot && sections.series}
    </>
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

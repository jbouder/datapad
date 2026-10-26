import {
  CalendarBlankIcon,
  ChartBarHorizontalIcon,
  RowsIcon,
} from '@phosphor-icons/react';
import { topicCount } from '#shared/meetings';
import {
  type DateString,
  type Meeting,
  type Snapshot,
  topicsOf,
} from '#shared/types';
import { Calendar } from '@/components/layouts/Calendar';
import { Timeline } from '@/components/layouts/Timeline';
import type { ViewOption } from '@/components/layouts/ViewSwitcher';
import { useMeetingForm } from '@/components/meetings/MeetingFormProvider';
import { MeetingList } from '@/components/meetings/MeetingList';
import { MeetingRow } from '@/components/meetings/MeetingRow';
import { navigate } from '@/lib/router';

export type MeetingView = 'list' | 'calendar' | 'timeline';

export const MEETING_VIEWS: readonly ViewOption<MeetingView>[] = [
  { id: 'list', label: 'List', icon: RowsIcon },
  { id: 'calendar', label: 'Calendar', icon: CalendarBlankIcon },
  { id: 'timeline', label: 'Timeline', icon: ChartBarHorizontalIcon },
];

/** A calendar chip's topic count: "1/3" shown, "1 of 3 topics" read. */
function topicMeta(meeting: Meeting) {
  const topics = topicsOf(meeting);
  if (topics.length === 0) return undefined;
  const covered = topics.filter((t) => t.done).length;
  return (
    <>
      <span aria-hidden>
        {covered}/{topics.length}
      </span>
      <span className="sr-only">, {topicCount(topics)}</span>
    </>
  );
}

interface Props {
  view: MeetingView;
  /** Already filtered, soonest first. */
  meetings: Meeting[];
  state: Snapshot;
  today: DateString;
  /** The project a new meeting starts in (the page's filter). */
  projectId: string | null;
  empty: string;
}

/**
 * The same meetings as a List (by month, Past collapsed), a Calendar (a
 * month, or a week on phones; click a day to add) or a Timeline (a lane
 * per project). The page's filters apply to all three.
 */
export function MeetingLayouts({
  view,
  meetings,
  state,
  today,
  projectId,
  empty,
}: Props) {
  const { newMeeting } = useMeetingForm();
  const open = (id: string) => navigate({ name: 'meeting', id });

  if (view === 'calendar') {
    const byId = new Map(meetings.map((e) => [e.id, e]));
    return (
      <Calendar
        label="Meetings calendar"
        noun="meeting"
        items={meetings.map((e) => ({
          id: e.id,
          date: e.date,
          time: e.time,
          label: e.title,
          meta: topicMeta(e),
          className: 'bg-muted',
        }))}
        onOpen={open}
        onAddDay={(date) => newMeeting({ projectId, date })}
        renderDay={(_day, ids) =>
          ids.map((id) => {
            const e = byId.get(id);
            return e ? (
              <MeetingRow key={id} meeting={e} state={state} today={today} />
            ) : null;
          })
        }
      />
    );
  }

  if (view === 'timeline') {
    const lanes = [
      ...Object.values(state.projects)
        .filter((p) => meetings.some((e) => e.projectId === p.id))
        .sort(
          (a, b) =>
            Number(a.archived) - Number(b.archived) ||
            a.name.localeCompare(b.name),
        )
        .map((p) => ({
          id: p.id,
          label: p.archived ? `${p.name} (archived)` : p.name,
        })),
      ...(meetings.some((e) => e.projectId === null)
        ? [{ id: 'general', label: 'General' }]
        : []),
    ];
    return (
      <Timeline
        label="Meetings over time"
        defaultZoom="month"
        rows={lanes.map((lane) => ({
          id: lane.id,
          label: lane.label,
          noBar: true,
          points: meetings
            .filter((e) => (e.projectId ?? 'general') === lane.id)
            .map((e) => ({
              id: e.id,
              date: e.date,
              time: e.time || undefined,
              end: e.end || undefined,
              label: e.title,
              kind: 'meeting' as const,
            })),
        }))}
        onOpenPoint={(_lane, id) => open(id)}
      />
    );
  }

  return (
    <MeetingList
      meetings={meetings}
      state={state}
      today={today}
      empty={empty}
    />
  );
}

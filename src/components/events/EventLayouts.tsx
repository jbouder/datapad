import {
  CalendarBlankIcon,
  ChartBarHorizontalIcon,
  RowsIcon,
} from '@phosphor-icons/react';
import type { DateString, Meeting, Snapshot } from '#shared/types';
import { useEventForm } from '@/components/events/EventFormProvider';
import { EventList } from '@/components/events/EventList';
import { EventRow } from '@/components/events/EventRow';
import { Calendar } from '@/components/layouts/Calendar';
import { Timeline } from '@/components/layouts/Timeline';
import type { ViewOption } from '@/components/layouts/ViewSwitcher';

export type EventView = 'list' | 'calendar' | 'timeline';

export const EVENT_VIEWS: readonly ViewOption<EventView>[] = [
  { id: 'list', label: 'List', icon: RowsIcon },
  { id: 'calendar', label: 'Calendar', icon: CalendarBlankIcon },
  { id: 'timeline', label: 'Timeline', icon: ChartBarHorizontalIcon },
];

interface Props {
  view: EventView;
  /** Already filtered, soonest first. */
  events: Meeting[];
  state: Snapshot;
  today: DateString;
  /** The project a new event starts in (the page's filter). */
  projectId: string | null;
  empty: string;
}

/**
 * The same events as a List (by month, Past collapsed), a Calendar (a
 * month, or a week on phones; click a day to add) or a Timeline (a lane
 * per project). The page's filters apply to all three.
 */
export function EventLayouts({
  view,
  events,
  state,
  today,
  projectId,
  empty,
}: Props) {
  const { openEvent, newEvent } = useEventForm();

  if (view === 'calendar') {
    const byId = new Map(events.map((e) => [e.id, e]));
    return (
      <Calendar
        label="Events calendar"
        noun="event"
        items={events.map((e) => ({
          id: e.id,
          date: e.date,
          time: e.time,
          label: e.title,
          className: 'bg-muted',
        }))}
        onOpen={openEvent}
        onAddDay={(date) => newEvent({ projectId, date })}
        renderDay={(_day, ids) =>
          ids.map((id) => {
            const e = byId.get(id);
            return e ? (
              <EventRow key={id} event={e} state={state} today={today} />
            ) : null;
          })
        }
      />
    );
  }

  if (view === 'timeline') {
    const lanes = [
      ...Object.values(state.projects)
        .filter((p) => events.some((e) => e.projectId === p.id))
        .sort(
          (a, b) =>
            Number(a.archived) - Number(b.archived) ||
            a.name.localeCompare(b.name),
        )
        .map((p) => ({
          id: p.id,
          label: p.archived ? `${p.name} (archived)` : p.name,
        })),
      ...(events.some((e) => e.projectId === null)
        ? [{ id: 'general', label: 'General' }]
        : []),
    ];
    return (
      <Timeline
        label="Events over time"
        defaultZoom="month"
        rows={lanes.map((lane) => ({
          id: lane.id,
          label: lane.label,
          noBar: true,
          points: events
            .filter((e) => (e.projectId ?? 'general') === lane.id)
            .map((e) => ({
              id: e.id,
              date: e.date,
              time: e.time || undefined,
              end: e.end || undefined,
              label: e.title,
              kind: 'event' as const,
            })),
        }))}
        onOpenPoint={(_lane, id) => openEvent(id)}
      />
    );
  }

  return (
    <EventList events={events} state={state} today={today} empty={empty} />
  );
}

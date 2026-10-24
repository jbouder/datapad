import {
  ArrowSquareOutIcon,
  DotsThreeIcon,
  PencilSimpleIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { formatDay } from '#shared/dates';
import { timeRange } from '#shared/events';
import type { Event, Person, Snapshot } from '#shared/types';
import { deleteEventQuestion } from '@/components/events/EventForm';
import { useEventForm } from '@/components/events/EventFormProvider';
import { TypePill } from '@/components/events/TypePill';
import { Initials } from '@/components/Initials';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDatapad } from '@/hooks/useDatapad';
import { linkProps } from '@/lib/router';
import { cn } from '@/lib/utils';
import { useToast } from '@/providers/ToastProvider';

const MENU_TRIGGER =
  'press flex size-11 shrink-0 items-center justify-center outline-ring/50 hover:bg-accent focus-visible:outline-2 data-popup-open:bg-accent desk:size-8';

/**
 * One event: its day and times, type pill, title (opens the form),
 * project chip, attendees, link, and the actions. Delete asks in the row
 * first; the event's notes are kept.
 */
export function EventRow({
  event,
  state,
  today,
  showProject = true,
  className,
  style,
}: {
  event: Event;
  state: Snapshot;
  today: string;
  showProject?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { actions } = useDatapad();
  const { openEvent } = useEventForm();
  const { show } = useToast();
  const [confirming, setConfirming] = useState(false);
  const project = event.projectId ? state.projects[event.projectId] : null;
  const attendees = event.attendees
    .map((id) => state.people[id])
    .filter((p): p is Person => Boolean(p));
  const range = timeRange(event);
  const notes = Object.values(state.notes).filter(
    (n) => n.eventId === event.id,
  ).length;

  const remove = () => {
    if (!actions.deleteEvent({ id: event.id })) return;
    show(`Deleted “${event.title}”`);
  };

  return (
    <div
      data-event-id={event.id}
      data-layout-id={event.id}
      className={cn('flex flex-col border-b', className)}
      style={style}
    >
      <div className="flex min-h-11 items-start gap-1 py-1.5 desk:items-center desk:gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1 pt-1 desk:flex-row desk:items-center desk:gap-3 desk:pt-0">
          <span className="flex shrink-0 items-baseline gap-2 text-xs text-muted-foreground tabular-nums desk:w-40">
            <span className="text-foreground">
              {formatDay(event.date, today)}
            </span>
            {range && <span>{range}</span>}
          </span>
          <span className="flex min-w-0 items-center gap-2 desk:flex-1 desk:gap-3">
            <TypePill type={event.type} />
            <button
              type="button"
              onClick={() => openEvent(event.id)}
              className="min-w-0 text-left text-sm font-medium underline-offset-4 outline-ring/50 hover:underline focus-visible:outline-2 desk:flex-1 desk:truncate"
            >
              {event.title}
            </button>
          </span>
          {(showProject || attendees.length > 0) && (
            <span className="flex min-w-0 flex-wrap items-center gap-2 desk:shrink-0 desk:flex-nowrap">
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
        {event.link && (
          <a
            href={event.link}
            target="_blank"
            rel="noopener noreferrer"
            className="press flex size-11 shrink-0 items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground desk:size-8"
          >
            <ArrowSquareOutIcon aria-hidden />
            <span className="sr-only">
              Link for “{event.title}” (opens in a new tab)
            </span>
          </a>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            className={MENU_TRIGGER}
            aria-label={`More for “${event.title}”`}
          >
            <DotsThreeIcon weight="bold" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {/* Summarize joins these with on-device summaries (M6). */}
            <DropdownMenuItem onClick={() => openEvent(event.id)}>
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
      {event.note && (
        <p className="pb-2 text-xs whitespace-pre-line text-muted-foreground desk:pl-43">
          {event.note}
        </p>
      )}
      {confirming && (
        <div
          role="alertdialog"
          aria-labelledby={`delete-${event.id}`}
          className="flex flex-wrap items-center gap-2 bg-muted px-2 py-2"
        >
          <p id={`delete-${event.id}`} className="flex-1 text-sm">
            {deleteEventQuestion(event.title, notes)}
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
            Delete event
          </Button>
        </div>
      )}
    </div>
  );
}

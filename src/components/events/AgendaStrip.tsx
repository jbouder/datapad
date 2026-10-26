import { FlagIcon } from '@phosphor-icons/react';
import { describeDay } from '#shared/dates';
import { timeRange } from '#shared/meetings';
import type { AgendaItem } from '#shared/select';
import type { Snapshot } from '#shared/types';
import { useEventNotes } from '@/components/events/EventNotesProvider';
import { Button } from '@/components/ui/button';
import { linkProps } from '@/lib/router';

const CARD =
  'relative flex w-64 shrink-0 snap-start flex-col gap-1.5 border bg-card p-3 text-card-foreground has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-ring hover:bg-accent/40';

/**
 * Focus's agenda: the next seven days of meetings and milestones as a
 * strip of cards that scrolls sideways (snapping card by card on phones).
 * A meeting's card links to it on the Meetings page, and Prep and Debrief
 * start its notes; a milestone's card, flagged, opens its project at it.
 */
export function AgendaStrip({
  items,
  state,
  today,
}: {
  items: AgendaItem[];
  state: Snapshot;
  today: string;
}) {
  const { startNote } = useEventNotes();
  return (
    <section aria-labelledby="agenda-title" className="flex min-w-0 flex-col">
      <h2 id="agenda-title" className="pb-1 font-heading text-sm font-semibold">
        Next 7 days
      </h2>
      <ul
        aria-labelledby="agenda-title"
        className="scrollbar-thin -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto px-4 pb-2 desk:mx-0 desk:snap-none desk:px-0"
      >
        {items.map((item) => {
          if (item.kind === 'milestone') {
            const { milestone: m, project } = item;
            return (
              <li
                key={`milestone-${m.id}`}
                data-agenda-id={m.id}
                data-kind="milestone"
                className={CARD}
              >
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                  <FlagIcon aria-hidden weight="fill" className="shrink-0" />
                  <span className="text-foreground">
                    {describeDay(m.date, today)}
                  </span>
                  <span>Milestone</span>
                </span>
                <a
                  {...linkProps(
                    { name: 'project', id: project.id },
                    `milestone=${m.id}`,
                  )}
                  className="line-clamp-2 text-sm font-medium outline-none after:absolute after:inset-0"
                >
                  <span className="sr-only">Milestone: </span>
                  {m.title}
                </a>
                <span className="truncate text-xs text-muted-foreground">
                  {project.name}
                </span>
              </li>
            );
          }
          const e = item.meeting;
          const project = e.projectId ? state.projects[e.projectId] : null;
          const range = timeRange(e);
          return (
            <li
              key={`meeting-${e.id}`}
              data-agenda-id={e.id}
              data-kind="meeting"
              className={CARD}
            >
              <span className="flex items-baseline gap-2 text-xs text-muted-foreground tabular-nums">
                <span className="text-foreground">
                  {describeDay(e.date, today)}
                </span>
                {range && <span>{range}</span>}
              </span>
              <a
                {...linkProps({ name: 'events' }, `view=list&event=${e.id}`)}
                className="line-clamp-2 text-sm font-medium outline-none after:absolute after:inset-0"
              >
                {e.title}
              </a>
              <span className="truncate text-xs text-muted-foreground">
                {project?.name ?? 'General'}
              </span>
              <span className="relative -mx-1 -mb-1 flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="press h-11 px-2 text-xs desk:h-8"
                  onClick={() => startNote(e, 'pre')}
                >
                  Prep
                  <span className="sr-only"> note for “{e.title}”</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="press h-11 px-2 text-xs desk:h-8"
                  onClick={() => startNote(e, 'post')}
                >
                  Debrief
                  <span className="sr-only"> note for “{e.title}”</span>
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

import { FlagIcon } from '@phosphor-icons/react';
import { describeDay } from '#shared/dates';
import { timeRange } from '#shared/meetings';
import { type AgendaItem, prepLine, prepOf } from '#shared/select';
import type { Snapshot } from '#shared/types';
import { useClock } from '@/hooks/useClock';
import { linkProps } from '@/lib/router';

/** Every card the same height, whatever it holds (#218). */
const CARD =
  'relative flex h-34 w-64 shrink-0 snap-start flex-col gap-1.5 overflow-hidden border bg-card p-3 text-card-foreground has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-ring hover:bg-accent/40';

/**
 * Focus's agenda: today's or the next seven days' meetings and milestones
 * (Focus picks them and the `title`) as a
 * strip of cards that scrolls sideways (snapping card by card on phones).
 * A meeting's card links to its page and says in one muted line where its
 * prep stands (topics left and carried, the previous meeting's open action
 * items, no note yet), clamped to that line: every card is one height. A
 * meeting's notes are written on its page or panel. A milestone's card,
 * flagged, opens its project at it.
 */
export function AgendaStrip({
  items,
  state,
  today,
  title = 'Next 7 days',
}: {
  items: AgendaItem[];
  state: Snapshot;
  today: string;
  title?: string;
}) {
  const clock = useClock();

  return (
    <section aria-labelledby="agenda-title" className="flex min-w-0 flex-col">
      <h2 id="agenda-title" className="pb-1 font-heading text-sm font-semibold">
        {title}
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
          const range = timeRange(e, clock);
          const prep = prepLine(prepOf(e, state), today);
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
                {...linkProps({ name: 'meeting', id: e.id })}
                className="line-clamp-2 text-sm font-medium outline-none after:absolute after:inset-0"
              >
                {e.title}
              </a>
              <span className="truncate text-xs text-muted-foreground">
                {project?.name ?? 'General'}
              </span>
              {prep && (
                <span
                  data-prep
                  title={prep}
                  className="truncate text-xs text-muted-foreground tabular-nums"
                >
                  {prep}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

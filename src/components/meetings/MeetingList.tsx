import { CaretRightIcon } from '@phosphor-icons/react';
import { useId, useMemo, useRef, useState } from 'react';
import { monthLabel, splitByMonth } from '#shared/meetings';
import type { Meeting, Snapshot } from '#shared/types';
import { MeetingRow } from '@/components/meetings/MeetingRow';
import { withViewTransition } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useMotion } from '@/providers/MotionProvider';

/**
 * Meetings (soonest first) as upcoming months, then Past (newest first,
 * collapsed until asked for). Rows that arrive after the list first drew
 * come in with `.enter`; opening Past is a `filter` transition.
 */
export function MeetingList({
  meetings,
  state,
  today,
  showProject = true,
  headingLevel = 2,
  empty,
}: {
  meetings: Meeting[];
  state: Snapshot;
  today: string;
  showProject?: boolean;
  /** The month headings' level: 2 on the Meetings page, 3 in a section. */
  headingLevel?: 2 | 3;
  empty: string;
}) {
  const { active } = useMotion();
  const id = useId();
  const [pastOpen, setPastOpen] = useState(false);
  const { upcoming, past } = useMemo(
    () => splitByMonth(meetings, today),
    [meetings, today],
  );

  // What was there at first stays still; anything added later enters.
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null) seen.current = new Set(meetings.map((e) => e.id));
  const fresh = (e: Meeting) => !seen.current?.has(e.id);
  const Heading = headingLevel === 2 ? 'h2' : 'h3';

  const row = (e: Meeting) => (
    <MeetingRow
      key={e.id}
      meeting={e}
      state={state}
      today={today}
      showProject={showProject}
      className={cn(fresh(e) && 'enter')}
    />
  );

  return (
    <div className="vt-list flex flex-col gap-5">
      {upcoming.length === 0 ? (
        <p className="text-state">{empty}</p>
      ) : (
        upcoming.map((m) => (
          <section
            key={m.month}
            aria-labelledby={`${id}-${m.month}`}
            className="flex flex-col"
          >
            <Heading
              id={`${id}-${m.month}`}
              className="border-b pb-1 text-xs font-medium text-muted-foreground"
            >
              {monthLabel(m.month)}
            </Heading>
            {m.meetings.map(row)}
          </section>
        ))
      )}
      {past.length > 0 && (
        <section aria-labelledby={`${id}-past`} className="flex flex-col">
          <Heading id={`${id}-past`} className="flex">
            <button
              type="button"
              aria-expanded={pastOpen}
              aria-controls={`${id}-past-list`}
              onClick={() =>
                withViewTransition(
                  () => setPastOpen((o) => !o),
                  active,
                  'filter',
                )
              }
              className="press -ml-1 flex min-h-11 items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground outline-ring/50 hover:text-foreground focus-visible:outline-2 desk:min-h-8"
            >
              <CaretRightIcon
                weight="bold"
                aria-hidden
                className={cn(
                  'size-3 transition-transform duration-(--duration-fast)',
                  pastOpen && 'rotate-90',
                )}
              />
              Past
              <span className="count tabular-nums">{past.length}</span>
            </button>
          </Heading>
          <div id={`${id}-past-list`} hidden={!pastOpen} className="border-t">
            {pastOpen && past.map(row)}
          </div>
        </section>
      )}
    </div>
  );
}

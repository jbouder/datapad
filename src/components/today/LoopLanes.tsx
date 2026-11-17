import { useCallback } from 'react';
import { type Lanes, NOBODY, waitingCount } from '#shared/loops';
import type { PageKey, Snapshot, Task } from '#shared/types';
import { OrderedSections, Section } from '@/components/Section';
import { useTaskPanels } from '@/components/tasks/TaskPanelProvider';
import { LoopRow } from '@/components/today/LoopRow';
import { useTaskToggle } from '@/hooks/useTaskToggle';
import { linkProps } from '@/lib/router';

const GROUP_HEAD =
  'flex min-h-11 items-center gap-1.5 pt-1 text-sm desk:min-h-8';
const GROUP_LINK =
  'font-medium underline-offset-2 outline-ring/50 hover:underline focus-visible:outline-2';

/**
 * The three lanes of open loops (#331): Mine, Waiting on (grouped by who
 * it waits on) and To decide, each a section that collapses, in the
 * order `page` saved, without the hidden ones. A row's checkbox closes
 * the task (the toast offers Undo) and its title opens the task panel.
 * Today shows them beside the day; the rooms reuse them (#334, #335).
 */
export function LoopLanes({
  lanes,
  page,
  today,
  projects,
  people,
}: {
  lanes: Lanes;
  page: PageKey;
  today: string;
  projects: Snapshot['projects'];
  people: Snapshot['people'];
}) {
  const { openTask } = useTaskPanels();
  const { toggle, isDone } = useTaskToggle();
  const onOpen = useCallback((task: Task) => openTask(task.id), [openTask]);

  const personOf = (task: Task) => {
    // You are not named on your own loops.
    const p = task.assignee ? people[task.assignee] : undefined;
    return p && !p.me ? { id: p.id, name: p.name } : undefined;
  };

  const list = (tasks: Task[], label: string, showPerson: boolean) => (
    <ul aria-label={label} className="flex flex-col border-t">
      {tasks.map((task) => (
        <li key={task.id} data-flip-id={task.id}>
          <LoopRow
            task={task}
            done={isDone(task)}
            today={today}
            projects={projects}
            person={showPerson ? personOf(task) : undefined}
            onToggle={toggle}
            onOpen={onOpen}
          />
        </li>
      ))}
    </ul>
  );

  const empty = (text: string) => (
    <p className="py-2 text-sm text-muted-foreground">{text}</p>
  );

  return (
    <OrderedSections
      page={page}
      sections={{
        mine: (
          <Section
            title="Mine"
            count={lanes.mine.length}
            remember={{ page, key: 'mine' }}
          >
            {lanes.mine.length > 0
              ? list(lanes.mine, 'Mine', true)
              : empty('Nothing open is yours.')}
          </Section>
        ),
        waiting: (
          <Section
            title="Waiting on"
            count={waitingCount(lanes)}
            remember={{ page, key: 'waiting' }}
          >
            {lanes.waiting.length > 0 ? (
              <div className="flex flex-col gap-2">
                {lanes.waiting.map(({ personId, tasks }) => {
                  const person = people[personId];
                  const name =
                    personId === NOBODY || !person
                      ? 'Not on anyone'
                      : person.name;
                  const id = `waiting-${personId || 'none'}`;
                  return (
                    <section
                      key={id}
                      aria-labelledby={id}
                      data-waiting={personId}
                      className="flex flex-col"
                    >
                      <h3 id={id} className={GROUP_HEAD}>
                        {person ? (
                          <a
                            {...linkProps({ name: 'person', id: person.id })}
                            className={GROUP_LINK}
                          >
                            {name}
                          </a>
                        ) : (
                          <span className="font-medium">{name}</span>
                        )}
                        <span className="count text-xs text-muted-foreground tabular-nums">
                          {tasks.length}
                        </span>
                      </h3>
                      {list(tasks, `Waiting on ${name}`, false)}
                    </section>
                  );
                })}
              </div>
            ) : (
              empty('Nobody owes you anything.')
            )}
          </Section>
        ),
        decide: (
          <Section
            title="To decide"
            count={lanes.decide.length}
            remember={{ page, key: 'decide' }}
          >
            {lanes.decide.length > 0
              ? list(lanes.decide, 'To decide', true)
              : empty('Nothing to decide.')}
          </Section>
        ),
      }}
    />
  );
}

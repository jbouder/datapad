import { PencilSimpleIcon } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { mentionSnippet } from '#shared/mentions';
import { mentionsOf, type PersonStats } from '#shared/select';
import type { Note, Person, Snapshot, Task } from '#shared/types';
import { DecisionList } from '@/components/decisions/DecisionList';
import { Initials } from '@/components/Initials';
import { TaskList } from '@/components/tasks/TaskList';
import { useTaskPanels } from '@/components/tasks/TaskPanelProvider';
import { Button } from '@/components/ui/button';
import { useToday } from '@/hooks/useNow';
import { linkProps } from '@/lib/router';

type Mention = { kind: 'note'; doc: Note } | { kind: 'task'; doc: Task };

interface MentionGroup {
  /** Null is General. */
  projectId: string | null;
  items: Mention[];
}

/** Mentions by project, groups and items newest first. */
function groupMentions(notes: Note[], tasks: Task[]): MentionGroup[] {
  const items: Array<Mention & { at: string }> = [
    ...notes.map((doc) => ({ kind: 'note' as const, doc, at: doc.createdAt })),
    ...tasks.map((doc) => ({ kind: 'task' as const, doc, at: doc.updatedAt })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const groups = new Map<string | null, MentionGroup>();
  for (const { at: _, ...item } of items) {
    const key = item.doc.projectId;
    let group = groups.get(key);
    if (!group) {
      group = { projectId: key, items: [] };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  return [...groups.values()];
}

/**
 * What is going on with one person, before a 1:1: their projects, the
 * open tasks assigned to them, and every note and task that mentions
 * them, grouped by project, newest first.
 */
export function PersonDetail({
  person,
  stats,
  state,
  onEdit,
}: {
  person: Person;
  stats: PersonStats;
  state: Snapshot;
  onEdit: () => void;
}) {
  const { openTask } = useTaskPanels();
  const today = useToday();
  const mentions = mentionsOf(state.notes, state.tasks, person.id);
  const groups = useMemo(
    () => groupMentions(mentions.notes, mentions.tasks),
    [mentions],
  );
  const count = mentions.notes.length + mentions.tasks.length;

  return (
    <section
      aria-labelledby="person-title"
      data-person-id={person.id}
      className="flex min-w-0 flex-col gap-5"
    >
      <div className="flex items-start gap-3">
        <Initials person={person} className="size-10 text-xs" />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2
            id="person-title"
            className="flex flex-wrap items-center gap-2 font-heading text-lg font-semibold"
          >
            {person.name}
            {person.me && <YouTag />}
          </h2>
          {person.role && (
            <p className="text-sm text-muted-foreground">{person.role}</p>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          className="press h-11 desk:h-8"
          onClick={onEdit}
        >
          <PencilSimpleIcon />
          Edit<span className="sr-only"> {person.name}</span>
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-heading text-sm font-semibold">Projects</h3>
        {stats.projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Not on any project. Add them in a project’s form.
          </p>
        ) : (
          <ul aria-label="Projects" className="flex flex-wrap gap-1.5">
            {stats.projects.map((p) => (
              <li key={p.id}>
                <a
                  {...linkProps({ name: 'project', id: p.id })}
                  className="press flex min-h-11 items-center border px-2 text-xs hover:bg-accent desk:min-h-8"
                >
                  {p.name}
                  {p.archived && (
                    <span className="ml-1.5 text-muted-foreground">
                      (archived)
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-heading text-sm font-semibold">
          Open tasks{' '}
          <span className="count font-sans text-xs font-normal text-muted-foreground tabular-nums">
            {stats.open.length}
          </span>
        </h3>
        <TaskList
          label={`Open tasks assigned to ${person.name}`}
          open={stats.open}
          empty="Nothing assigned."
        />
      </div>

      {stats.waiting.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="font-heading text-sm font-semibold">
            Waiting on them{' '}
            <span className="count font-sans text-xs font-normal text-muted-foreground tabular-nums">
              {stats.waiting.length}
            </span>
          </h3>
          <TaskList
            label={`Tasks waiting on ${person.name}`}
            open={stats.waiting}
            empty="Nothing is waiting on them."
          />
        </div>
      )}

      {stats.decisions.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="font-heading text-sm font-semibold">
            Decisions{' '}
            <span className="count font-sans text-xs font-normal text-muted-foreground tabular-nums">
              {stats.decisions.length}
            </span>
          </h3>
          <DecisionList
            decisions={stats.decisions}
            people={state.people}
            today={today}
            label={`Decisions ${person.name} took part in`}
            empty=""
            showProject={(x) =>
              x.projectId
                ? (state.projects[x.projectId]?.name ?? 'General')
                : 'General'
            }
          />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="font-heading text-sm font-semibold">
          Mentions{' '}
          <span className="count font-sans text-xs font-normal text-muted-foreground tabular-nums">
            {count}
          </span>
        </h3>
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No notes or tasks mention them yet.
          </p>
        ) : (
          groups.map((g) => {
            const project = g.projectId ? state.projects[g.projectId] : null;
            const title = project?.name ?? 'General';
            return (
              <section
                key={g.projectId ?? ''}
                aria-label={`Mentions in ${title}`}
                className="flex flex-col"
              >
                <h4 className="text-xs font-medium text-muted-foreground">
                  {title}
                </h4>
                <ul className="flex flex-col border-t">
                  {g.items.map((m) => (
                    <li key={m.doc.id} className="border-b">
                      {m.kind === 'note' ? (
                        <a
                          {...linkProps({ name: 'notes' }, `note=${m.doc.id}`)}
                          className="press flex min-h-11 flex-col justify-center gap-0.5 py-1.5 text-sm hover:bg-accent/50"
                        >
                          <span className="text-xs text-muted-foreground">
                            Note
                          </span>
                          <span className="line-clamp-2">
                            {mentionSnippet(
                              m.doc.body,
                              person.id,
                              state.people,
                            )}
                          </span>
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openTask(m.doc.id)}
                          className="press flex min-h-11 w-full flex-col justify-center gap-0.5 py-1.5 text-left text-sm outline-ring/50 hover:bg-accent/50 focus-visible:outline-2"
                        >
                          <span className="text-xs text-muted-foreground">
                            Task · {m.doc.title}
                          </span>
                          <span className="line-clamp-2">
                            {mentionSnippet(
                              m.doc.desc,
                              person.id,
                              state.people,
                            )}
                          </span>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>
    </section>
  );
}

export function YouTag() {
  return (
    <span className="bg-accent px-1.5 py-0.5 font-sans text-[11px] font-semibold text-accent-foreground">
      you
    </span>
  );
}

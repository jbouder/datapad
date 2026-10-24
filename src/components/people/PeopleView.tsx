import { PlusIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { peopleStats, statsFor } from '#shared/select';
import type { Person } from '#shared/types';
import { PersonDetail, YouTag } from '@/components/people/PersonDetail';
import { PersonForm } from '@/components/people/PersonForm';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { linkProps, navigate } from '@/lib/router';
import { cn } from '@/lib/utils';

/** Which person the form is for: someone to edit, or `null` for new. */
interface Editing {
  key: number;
  id: string | null;
  open: boolean;
}

/**
 * Settings → People: everyone, by name, beside the selected person's
 * detail (stacked on phones). Selecting someone is a link
 * (`/settings/people/:id`), so search and other pages can point here.
 * Add, Edit and Remove go through the person panel.
 */
export function PeopleView({ selected }: { selected?: string }) {
  const { state } = useDatapad();
  const [editing, setEditing] = useState<Editing | null>(null);
  const detail = useRef<HTMLDivElement>(null);

  const people = useMemo(
    () =>
      Object.values(state?.people ?? {}).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [state?.people],
  );
  const stats = state ? peopleStats(state.projects, state.tasks) : null;
  const person: Person | undefined = selected
    ? state?.people[selected]
    : undefined;

  // On phones the detail sits under the list: bring it into view.
  useEffect(() => {
    if (!selected || !detail.current) return;
    if (window.matchMedia('(width < 820px)').matches) {
      detail.current.scrollIntoView({ block: 'start' });
    }
  }, [selected]);

  if (!state || !stats) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const editPerson = editing?.id ? state.people[editing.id] : undefined;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-muted-foreground">
          The people you assign, add to projects and mention. Mark yourself to
          use the “Mine” filters.
        </p>
        <Button
          className="press h-11 desk:h-8"
          onClick={() => setEditing({ key: Date.now(), id: null, open: true })}
        >
          <PlusIcon />
          Add person
        </Button>
      </div>

      {people.length === 0 ? (
        <p className="text-state">
          No people yet. Add your team members to assign tasks and mention them
          in notes.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 desk:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
          <ul aria-label="People" className="flex flex-col self-start border-t">
            {people.map((p) => (
              <li key={p.id} className="border-b">
                <a
                  {...linkProps({
                    name: 'settings',
                    section: 'people',
                    person: p.id,
                  })}
                  aria-current={p.id === selected ? 'true' : undefined}
                  className={cn(
                    'press row flex items-center gap-2 px-2 text-sm outline-ring/50 hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2',
                    p.id === selected && 'bg-accent text-accent-foreground',
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col py-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{p.name}</span>
                      {p.me && <YouTag />}
                    </span>
                    {p.role && (
                      <span className="truncate text-xs text-muted-foreground">
                        {p.role}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {statsFor(stats, p.id).open.length} open
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <div ref={detail} className="min-w-0 scroll-mt-20">
            {person ? (
              <PersonDetail
                person={person}
                stats={statsFor(stats, person.id)}
                state={state}
                onEdit={() =>
                  setEditing({ key: Date.now(), id: person.id, open: true })
                }
              />
            ) : (
              <p className="text-state">
                {selected
                  ? 'That person is no longer here.'
                  : 'Pick someone to see their projects, tasks and mentions.'}
              </p>
            )}
          </div>
        </div>
      )}

      {editing && (editing.id === null || editPerson) && (
        <PersonForm
          key={editing.key}
          person={editPerson}
          open={editing.open}
          onClose={() => setEditing((e) => (e ? { ...e, open: false } : e))}
          onExited={() => setEditing((e) => (e?.open ? e : null))}
          onAdded={(id) =>
            navigate({ name: 'settings', section: 'people', person: id })
          }
          onRemoved={() => navigate({ name: 'settings', section: 'people' })}
        />
      )}
    </>
  );
}

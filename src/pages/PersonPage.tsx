import { useState } from 'react';
import { peopleStats, statsFor } from '#shared/select';
import { PersonDetail } from '@/components/people/PersonDetail';
import { PersonForm } from '@/components/people/PersonForm';
import { useDatapad } from '@/hooks/useDatapad';
import { usePageTitle } from '@/hooks/usePageTitle';
import { navigate } from '@/lib/router';
import { NotFoundPage } from '@/pages/NotFoundPage';

/**
 * A person's room (`/people/:id`, #329). For now it is the person's
 * detail from Settings → People, with Pin in its header; #335 builds the
 * room itself. Edit and Remove go through the person panel.
 */
export function PersonPage({ id }: { id: string }) {
  const { state } = useDatapad();
  const person = state?.people[id];
  usePageTitle(person?.name ?? (state ? 'Not found' : 'Person'));
  const [editing, setEditing] = useState<{ key: number; open: boolean }>();

  if (!state) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!person) {
    return (
      <NotFoundPage
        what="person"
        back={{ name: 'people' }}
        backLabel="Go to People"
      />
    );
  }
  const stats = statsFor(peopleStats(state.projects, state.tasks), person.id);

  return (
    <div className="enter flex flex-col gap-6">
      <PersonDetail
        person={person}
        stats={stats}
        state={state}
        onEdit={() => setEditing({ key: Date.now(), open: true })}
      />
      {editing && (
        <PersonForm
          key={editing.key}
          person={person}
          open={editing.open}
          onClose={() => setEditing((e) => (e ? { ...e, open: false } : e))}
          onExited={() => setEditing((e) => (e?.open ? e : undefined))}
          onRemoved={() => navigate({ name: 'people' }, { replace: true })}
        />
      )}
    </div>
  );
}

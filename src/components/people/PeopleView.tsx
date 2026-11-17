import { ListIcon, PlusIcon, SquaresFourIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { findText } from '#shared/pages';
import { findPeople } from '#shared/people';
import { meId, peopleStats, statsFor } from '#shared/select';
import { settingsOf } from '#shared/types';
import { Initials } from '@/components/Initials';
import { FindField } from '@/components/inputs/FindField';
import { CardGrid } from '@/components/layouts/CardGrid';
import {
  ListEmpty,
  ListToolbar,
  useListFilters,
} from '@/components/layouts/ListToolbar';
import {
  useView,
  type ViewOption,
  ViewSwitcher,
} from '@/components/layouts/ViewSwitcher';
import { PersonForm } from '@/components/people/PersonForm';
import { YouTag } from '@/components/people/YouTag';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useDatapad } from '@/hooks/useDatapad';
import { linkProps } from '@/lib/router';
import { usePageQuery } from '@/providers/PagePrefsProvider';
import { useToast } from '@/providers/ToastProvider';

type PeopleLayout = 'list' | 'cards';

export const PEOPLE_VIEWS: readonly ViewOption<PeopleLayout>[] = [
  { id: 'list', label: 'List', icon: ListIcon },
  { id: 'cards', label: 'Cards', icon: SquaresFourIcon },
];

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * "Assign new tasks to me": synced with the space's settings. It needs
 * someone marked as you, so it is off and disabled until there is one;
 * left on after the mark goes, it says new tasks go to nobody.
 */
function AssignToMe() {
  const { state, actions } = useDatapad();
  const { show } = useToast();
  if (!state) return null;
  const on = settingsOf(state).assignToMe === true;
  const me = meId(state.people);
  const name = me ? state.people[me]?.name : undefined;
  const hint = !name
    ? on
      ? 'Nobody is marked as you, so new tasks go to nobody. Edit yourself and tick “This is me”.'
      : 'Mark yourself first: edit your record and tick “This is me”.'
    : on
      ? `New tasks go to ${name} unless you pick someone else.`
      : 'New tasks go to nobody unless you pick someone.';
  return (
    <label
      htmlFor="assign-to-me"
      className="flex min-h-11 items-center justify-between gap-4 text-sm desk:min-h-8"
    >
      <span className="flex flex-col">
        <span className="font-medium">Assign new tasks to me</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
      <Switch
        id="assign-to-me"
        checked={on}
        disabled={!on && !name}
        onCheckedChange={(next) => {
          if (actions.setSettings({ patch: { assignToMe: next } })) {
            show(
              next
                ? `New tasks go to ${name ?? 'you'}`
                : 'New tasks go to nobody',
            );
          }
        }}
      />
    </label>
  );
}

/** Which person the form is for: someone to edit, or `null` for new. */
interface Editing {
  key: number;
  id: string | null;
  open: boolean;
}

/**
 * People, as a List (everyone by name) or Cards (one card per person with
 * their counts). Each opens the person's room (`/people/:id`, #329). Add
 * goes through the person panel; Edit and Remove are in the room.
 */
export function PeopleView() {
  const { state } = useDatapad();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [view, setView] = useView('people', PEOPLE_VIEWS, 'list');
  const [query, change] = usePageQuery('people');
  const listFilters = useListFilters('people', query, change);
  const q = findText(query);

  const everyone = useMemo(
    () =>
      Object.values(state?.people ?? {}).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [state?.people],
  );
  const people = useMemo(
    () => findPeople(everyone, q, state?.orgs ?? {}),
    [everyone, q, state?.orgs],
  );
  const stats = state ? peopleStats(state.projects, state.tasks) : null;

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
        <ViewSwitcher views={PEOPLE_VIEWS} value={view} onChange={setView} />
        <Button
          className="press h-11 desk:h-8"
          onClick={() => setEditing({ key: Date.now(), id: null, open: true })}
        >
          <PlusIcon />
          Add person
        </Button>
      </div>

      <AssignToMe />

      {everyone.length === 0 ? (
        <p className="text-state">
          No people yet. Add your team members to assign tasks and mention them
          in notes.
        </p>
      ) : (
        <ListToolbar
          state={listFilters}
          find={
            <FindField
              value={q}
              placeholder="Name, role or org"
              onChange={(text) =>
                change({ q: text || null }, { replace: true })
              }
            />
          }
        />
      )}

      {everyone.length > 0 && (
        <div className="grid grid-cols-1 gap-6">
          {people.length === 0 ? (
            <div className="self-start">
              <ListEmpty state={listFilters}>No people yet.</ListEmpty>
            </div>
          ) : view === 'list' ? (
            <ul
              aria-label="People"
              className="flex flex-col self-start border-t"
            >
              {people.map((p) => (
                <li key={p.id} className="border-b">
                  <a
                    {...linkProps({ name: 'person', id: p.id })}
                    className="press row flex items-center gap-2 px-2 text-sm outline-ring/50 hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2"
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
          ) : (
            <CardGrid
              label="People"
              items={people}
              getId={(p) => p.id}
              renderCard={(p) => {
                const s = statsFor(stats, p.id);
                return (
                  <a
                    {...linkProps({ name: 'person', id: p.id })}
                    className="press flex min-h-24 items-start gap-3 border bg-card p-3 text-card-foreground outline-ring/50 hover:bg-accent/40 focus-visible:outline-2"
                  >
                    <Initials person={p} className="size-10 text-xs" />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-medium">{p.name}</span>
                        {p.me && <YouTag />}
                      </span>
                      {p.role && (
                        <span className="truncate text-xs text-muted-foreground">
                          {p.role}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {count(s.projects.length, 'project', 'projects')} ·{' '}
                        {count(s.open.length, 'open task', 'open tasks')}
                      </span>
                    </span>
                  </a>
                );
              }}
            />
          )}
        </div>
      )}

      {editing && (editing.id === null || editPerson) && (
        <PersonForm
          key={editing.key}
          person={editPerson}
          open={editing.open}
          onClose={() => setEditing((e) => (e ? { ...e, open: false } : e))}
          onExited={() => setEditing((e) => (e?.open ? e : null))}
        />
      )}
    </>
  );
}

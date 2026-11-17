/**
 * Prototype: All, where the type-by-type pages go. Every kind of item
 * in one filterable list, plus the rooms (on a phone, the only way to
 * them besides links).
 */
import { useMemo, useState } from 'react';
import { formatDay } from '#shared/dates';
import { notePreview } from '#shared/notes';
import { meId } from '#shared/select';
import type { Task } from '#shared/types';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { useToday } from '@/hooks/useNow';
import { lanesOf } from './model';
import { Chip, Go, RoomHeader, SectionTitle, TaskLine } from './parts';

const TYPES = ['task', 'note', 'meeting', 'list', 'project', 'person'] as const;
type ItemType = (typeof TYPES)[number];
const TYPE_LABELS: Record<ItemType, string> = {
  task: 'Tasks',
  note: 'Notes',
  meeting: 'Meetings',
  list: 'Lists',
  project: 'Projects',
  person: 'People',
};

interface Row {
  type: ItemType;
  id: string;
  title: string;
  where: string;
  when: string;
  done: boolean;
}

export function AllPage() {
  const { state } = useDatapad();
  const today = useToday();
  const [types, setTypes] = useState<Set<ItemType>>(new Set(['task']));
  const [q, setQ] = useState('');
  const [showDone, setShowDone] = useState(false);

  const rows = useMemo<Row[]>(() => {
    if (!state) return [];
    const proj = (id: string | null) =>
      id ? (state.projects[id]?.name ?? '') : '';
    return [
      ...Object.values(state.tasks).map((t) => ({
        type: 'task' as const,
        id: t.id,
        title: t.title,
        where: proj(t.projectId),
        when: t.due || t.createdAt.slice(0, 10),
        done: t.status === 'done',
      })),
      ...Object.values(state.notes)
        .filter((n) => !n.scratch)
        .map((n) => ({
          type: 'note' as const,
          id: n.id,
          title: notePreview(n.body, state.people),
          where: proj(n.projectId) || 'Unfiled',
          when: n.createdAt.slice(0, 10),
          done: false,
        })),
      ...Object.values(state.meetings).map((m) => ({
        type: 'meeting' as const,
        id: m.id,
        title: m.title,
        where: proj(m.projectId),
        when: m.date,
        done: m.date < today,
      })),
      ...Object.values(state.lists).map((l) => ({
        type: 'list' as const,
        id: l.id,
        title: l.title,
        where: proj(l.projectId),
        when: l.updatedAt.slice(0, 10),
        done: l.items.length > 0 && l.items.every((i) => i.done),
      })),
      ...Object.values(state.projects).map((p) => ({
        type: 'project' as const,
        id: p.id,
        title: p.name,
        where: p.org,
        when: p.targetDate || '',
        done: p.archived || p.status === 'done',
      })),
      ...Object.values(state.people).map((p) => ({
        type: 'person' as const,
        id: p.id,
        title: p.name,
        where: p.role,
        when: '',
        done: false,
      })),
    ];
  }, [state, today]);

  if (!state) return null;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = rows
    .filter((r) => types.size === 0 || types.has(r.type))
    .filter((r) => showDone || !r.done)
    .filter((r) => {
      const hay = `${r.title} ${r.where}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => b.when.localeCompare(a.when));

  const toggle = (t: ItemType) => {
    const next = new Set(types);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    setTypes(next);
  };

  const me = meId(state.people);
  const lanes = lanesOf(state, me);
  const busyPeople = new Map(
    lanes.waiting.map((g) => [g.personId, g.tasks.length]),
  );
  const rooms = Object.values(state.projects)
    .filter((p) => !p.archived && p.status === 'active')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const people = Object.values(state.people)
    .filter((p) => !p.me)
    .sort((a, b) => (busyPeople.get(b.id) ?? 0) - (busyPeople.get(a.id) ?? 0));

  return (
    <div>
      <RoomHeader
        title="All"
        state="Everything, by kind. The rooms are below."
      />
      <div className="mb-3 flex flex-col gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find"
          aria-label="Find"
          className="h-11 border border-border bg-transparent px-3 text-base outline-none focus:border-ring desk:h-8 desk:max-w-sm desk:text-sm"
        />
        <fieldset className="flex flex-wrap gap-1.5" aria-label="Kinds">
          {TYPES.map((t) => (
            <Button
              key={t}
              size="sm"
              variant={types.has(t) ? 'default' : 'outline'}
              aria-pressed={types.has(t)}
              onClick={() => toggle(t)}
              className="h-11 desk:h-7"
            >
              {TYPE_LABELS[t]}
            </Button>
          ))}
          <Button
            size="sm"
            variant={showDone ? 'secondary' : 'ghost'}
            aria-pressed={showDone}
            onClick={() => setShowDone(!showDone)}
            className="h-11 desk:h-7"
          >
            Include done and past
          </Button>
        </fieldset>
      </div>
      <p className="mb-2 text-muted-foreground text-xs">{shown.length} items</p>
      <ul className="mb-10 divide-y divide-border border-border border-y">
        {shown.slice(0, 200).map((r) =>
          r.type === 'task' && state.tasks[r.id] ? (
            <TaskLine key={r.id} task={state.tasks[r.id] as Task} />
          ) : (
            <li
              key={`${r.type}-${r.id}`}
              className="flex items-baseline gap-3 py-2 text-sm"
            >
              <span className="w-16 shrink-0 text-muted-foreground text-xs">
                {TYPE_LABELS[r.type]
                  .replace(/s$/, '')
                  .replace('Peopl', 'Person')}
              </span>
              <span className="min-w-0 flex-1 truncate">
                <RowLink row={r} />
              </span>
              {r.where && (
                <span className="hidden desk:inline">
                  <Chip>{r.where}</Chip>
                </span>
              )}
              <span className="w-20 shrink-0 text-right text-muted-foreground text-xs">
                {r.when ? formatDay(r.when, today) : ''}
              </span>
            </li>
          ),
        )}
      </ul>

      <div className="grid gap-8 desk:grid-cols-2">
        <section aria-label="Project rooms">
          <SectionTitle count={rooms.length}>Project rooms</SectionTitle>
          <ul className="flex flex-col">
            {rooms.map((p) => (
              <li key={p.id}>
                <Go
                  to={{ name: 'project', id: p.id }}
                  className="flex h-11 items-center hover:underline desk:h-8"
                >
                  {p.name}
                  {p.org && (
                    <span className="ml-2 text-muted-foreground text-xs">
                      {p.org}
                    </span>
                  )}
                </Go>
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="People rooms">
          <SectionTitle count={people.length}>People</SectionTitle>
          <ul className="flex flex-col">
            {people.map((p) => (
              <li key={p.id}>
                <Go
                  to={{ name: 'person', id: p.id }}
                  className="flex h-11 items-center hover:underline desk:h-8"
                >
                  {p.name}
                  {busyPeople.get(p.id) ? (
                    <span className="ml-2 text-warn text-xs">
                      owes you {busyPeople.get(p.id)}
                    </span>
                  ) : null}
                </Go>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function RowLink({ row }: { row: Row }) {
  switch (row.type) {
    case 'project':
      return (
        <Go to={{ name: 'project', id: row.id }} className="hover:underline">
          {row.title}
        </Go>
      );
    case 'person':
      return (
        <Go to={{ name: 'person', id: row.id }} className="hover:underline">
          {row.title}
        </Go>
      );
    case 'meeting':
      return (
        <Go to={{ name: 'meeting', id: row.id }} className="hover:underline">
          {row.title}
        </Go>
      );
    case 'list':
      return (
        <a
          href={`/lists/${encodeURIComponent(row.id)}`}
          className="hover:underline"
        >
          {row.title}
        </a>
      );
    case 'note':
      return (
        <a
          href={`/notes?note=${encodeURIComponent(row.id)}`}
          className="hover:underline"
        >
          {row.title || 'Untitled note'}
        </a>
      );
    default:
      return <span>{row.title}</span>;
  }
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { describeDay, localDate } from '#shared/dates';
import {
  groupByDay,
  type NoteFilters,
  queryWords,
  selectNotes,
} from '#shared/notes';
import { Segmented } from '@/components/inputs/Segmented';
import { SelectField } from '@/components/inputs/SelectField';
import { NoteCard } from '@/components/notes/NoteCard';
import { NoteForm } from '@/components/notes/NoteForm';
import { useNotes } from '@/components/notes/NotesProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDatapad } from '@/hooks/useDatapad';
import { useFlip } from '@/hooks/useFlip';
import { usePageTitle } from '@/hooks/usePageTitle';
import { withViewTransition } from '@/lib/motion';
import { setQuery, useQuery } from '@/lib/router';
import { useMotion } from '@/providers/MotionProvider';

/** How long typing in Find waits before filtering. */
const FIND_DEBOUNCE_MS = 150;

/** The view's controls, from the URL so Back restores them. */
function useNoteFilters(): NoteFilters {
  const value = useQuery().toString();
  return useMemo(() => {
    const q = new URLSearchParams(value);
    return {
      project: q.get('project') ?? '',
      pinned: q.get('pinned') === '1',
      q: q.get('q') ?? '',
    };
  }, [value]);
}

/**
 * Every note, newest first under its day: the composer at the top
 * (General unless you pick a project), then a project filter, Pinned and
 * Find. Filters live in the URL.
 */
export function NotesPage() {
  usePageTitle('Notes');
  const { state } = useDatapad();
  const { hidden } = useNotes();
  const { active } = useMotion();
  const filters = useNoteFilters();
  const [find, setFind] = useState(filters.q);
  const feed = useRef<HTMLDivElement>(null);
  useFlip(feed, active);

  // Find follows the URL (Back), and the URL follows Find after a pause.
  useEffect(() => setFind(filters.q), [filters.q]);
  useEffect(() => {
    if (find === filters.q) return;
    const timer = window.setTimeout(
      () => setQuery({ q: find || null }, { replace: true }),
      FIND_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [find, filters.q]);

  const changeQuery = useCallback(
    (changes: Record<string, string | null>) =>
      setQuery(changes, {
        transition: (update) => withViewTransition(update, active, 'filter'),
      }),
    [active],
  );

  const notes = useMemo(
    () => (state ? selectNotes(state, filters, hidden) : []),
    [state, filters, hidden],
  );
  const days = useMemo(() => groupByDay(notes), [notes]);
  const words = useMemo(() => queryWords(filters.q), [filters.q]);

  if (!state) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const today = localDate(new Date());
  const projects = Object.values(state.projects).sort(
    (a, b) =>
      Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name),
  );
  const filtered = Boolean(filters.project || filters.pinned || filters.q);
  const any = Object.keys(state.notes).length > hidden.size;

  return (
    <section
      aria-labelledby="notes-title"
      className="enter flex flex-col gap-4"
    >
      <h1 id="notes-title" className="text-page-title">
        Notes
      </h1>

      <NoteForm people={state.people} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 desk:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <SelectField
          label="Project"
          value={filters.project || 'all'}
          options={[
            { value: 'all', label: 'All projects' },
            { value: 'general', label: 'General' },
            ...projects.map((p) => ({
              value: p.id,
              label: p.archived ? `${p.name} (archived)` : p.name,
            })),
          ]}
          onChange={(v) => changeQuery({ project: v === 'all' ? null : v })}
        />
        <Segmented
          legend="Show"
          value={filters.pinned ? 'pinned' : 'all'}
          onChange={(v) => changeQuery({ pinned: v === 'pinned' ? '1' : null })}
          options={[
            { value: 'all', label: 'All' },
            { value: 'pinned', label: 'Pinned' },
          ]}
        />
        <div className="flex flex-col gap-1.5 sm:col-span-2 desk:col-span-1">
          <label htmlFor="note-find" className="text-xs font-medium">
            Find
          </label>
          <Input
            id="note-find"
            type="search"
            value={find}
            placeholder="Words in a note, or a name"
            autoComplete="off"
            onChange={(e) => setFind(e.target.value)}
            className="h-11 text-base desk:h-8 desk:text-xs"
          />
        </div>
      </div>

      <div ref={feed} className="vt-list flex flex-col gap-6">
        {days.length === 0 ? (
          any && filtered ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-state">No notes match.</p>
              <Button
                variant="outline"
                className="press h-11 desk:h-8"
                onClick={() => {
                  setFind('');
                  changeQuery({ project: null, pinned: null, q: null });
                }}
              >
                Clear the filters
              </Button>
            </div>
          ) : (
            <p className="text-state">
              No notes yet. Write one above; it lands here under today.
            </p>
          )
        ) : (
          days.map((d) => (
            <section
              key={d.day}
              aria-labelledby={`day-${d.day}`}
              className="flex flex-col gap-2"
            >
              <h2
                id={`day-${d.day}`}
                className="text-xs font-medium text-muted-foreground"
              >
                {describeDay(d.day, today)}
              </h2>
              {d.notes.map((n, i) => (
                <NoteCard
                  key={n.id}
                  note={n}
                  state={state}
                  highlight={words}
                  style={{ '--i': Math.min(i, 8) } as React.CSSProperties}
                />
              ))}
            </section>
          ))
        )}
      </div>
    </section>
  );
}

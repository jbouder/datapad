import { RowsIcon, SquaresFourIcon } from '@phosphor-icons/react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { describeDay, localDate } from '#shared/dates';
import {
  groupByDay,
  type NoteFilters,
  queryWords,
  selectNotes,
} from '#shared/notes';
import { Segmented } from '@/components/inputs/Segmented';
import { SelectField } from '@/components/inputs/SelectField';
import {
  useView,
  type ViewOption,
  ViewSwitcher,
} from '@/components/layouts/ViewSwitcher';
import { NoteCard } from '@/components/notes/NoteCard';
import { NoteForm } from '@/components/notes/NoteForm';
import { useNotes } from '@/components/notes/NotesProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDatapad } from '@/hooks/useDatapad';
import { useFlip } from '@/hooks/useFlip';
import { usePageTitle } from '@/hooks/usePageTitle';
import { withLayoutTransition, withViewTransition } from '@/lib/motion';
import { setQuery, useQuery } from '@/lib/router';
import { useMotion } from '@/providers/MotionProvider';

type NoteView = 'feed' | 'grid';

export const NOTE_VIEWS: readonly ViewOption<NoteView>[] = [
  { id: 'feed', label: 'Feed', icon: RowsIcon },
  { id: 'grid', label: 'Grid', icon: SquaresFourIcon },
];

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
 * Every note as a Feed (newest first under its day, the default) or a
 * Grid (compact cards, pinned first, opening in place). The composer is
 * at the top (General unless you pick a project), then a project filter,
 * Pinned and Find; filters and layout live in the URL.
 */
export function NotesPage() {
  usePageTitle('Notes');
  const { state } = useDatapad();
  const { hidden } = useNotes();
  const { active } = useMotion();
  const filters = useNoteFilters();
  const [view, setView] = useView('notes', NOTE_VIEWS, 'feed');
  const [open, setOpen] = useState<string | null>(null);
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
  const grid = useMemo(
    () => [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned)),
    [notes],
  );

  const toggleOpen = useCallback(
    (id: string) =>
      withLayoutTransition(
        () => setOpen((current) => (current === id ? null : id)),
        active,
      ),
    [active],
  );

  // An open card lies over the cells below it; when it reaches past the
  // grid, the grid makes room under itself so the page scrolls to it.
  const gridRef = useRef<HTMLUListElement>(null);
  const [overhang, setOverhang] = useState(0);
  const overhangRef = useRef(0);
  overhangRef.current = overhang;
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the notes change
  useLayoutEffect(() => {
    const list = gridRef.current;
    const card = open
      ? list?.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(open)}"]`)
      : null;
    if (!list || !card) {
      setOverhang(0);
      return;
    }
    const measure = () => {
      const below =
        card.getBoundingClientRect().bottom -
        list.getBoundingClientRect().bottom +
        overhangRef.current;
      setOverhang(Math.max(0, Math.ceil(below)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    return () => observer.disconnect();
  }, [open, notes]);

  // Esc closes the open grid card, and focus goes back to its own
  // Expand button once the collapsed card is on screen.
  const closing = useRef<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      closing.current = open;
      toggleOpen(open);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, toggleOpen]);
  useEffect(() => {
    const id = closing.current;
    if (open !== null || !id) return;
    closing.current = null;
    document
      .querySelector<HTMLElement>(
        `[data-note-id="${CSS.escape(id)}"] [aria-label="Expand note"]`,
      )
      ?.focus();
  }, [open]);
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
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="notes-title" className="text-page-title flex-1">
          Notes
        </h1>
        <ViewSwitcher views={NOTE_VIEWS} value={view} onChange={setView} />
      </div>

      <NoteForm people={state.people} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end desk:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
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
        ) : view === 'grid' ? (
          <ul
            ref={gridRef}
            aria-label="Notes"
            style={{ paddingBottom: overhang }}
            className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {grid.map((n) => {
              const isOpen = open === n.id;
              const card = (layout: boolean) => (
                <NoteCard
                  note={n}
                  state={state}
                  highlight={words}
                  when="day"
                  compact={!isOpen || !layout}
                  layout={layout}
                  expand={{ expanded: isOpen, toggle: () => toggleOpen(n.id) }}
                />
              );
              return (
                <li key={n.id} className="relative">
                  {isOpen ? (
                    <>
                      {/* Holds the cell's size so nothing else moves. */}
                      <div aria-hidden inert className="invisible">
                        {card(false)}
                      </div>
                      <div className="absolute inset-x-0 top-0 z-20 shadow-xl">
                        {card(true)}
                      </div>
                    </>
                  ) : (
                    card(true)
                  )}
                </li>
              );
            })}
          </ul>
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

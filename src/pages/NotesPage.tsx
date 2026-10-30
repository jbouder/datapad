import { PlusIcon, RowsIcon, SquaresFourIcon } from '@phosphor-icons/react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { localDate } from '#shared/dates';
import {
  type NoteFilters,
  notepadOf,
  queryWords,
  selectNotes,
} from '#shared/notes';
import type { Note } from '#shared/types';
import { FindField } from '@/components/inputs/FindField';
import { Segmented } from '@/components/inputs/Segmented';
import { SelectField } from '@/components/inputs/SelectField';
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
import { NoteCard } from '@/components/notes/NoteCard';
import { NoteList } from '@/components/notes/NoteList';
import { useNotes } from '@/components/notes/NotesProvider';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { useFlip } from '@/hooks/useFlip';
import { useMasonry } from '@/hooks/useMasonry';
import { usePageTitle } from '@/hooks/usePageTitle';
import { withLayoutTransition, withViewTransition } from '@/lib/motion';
import { navigate, useQuery } from '@/lib/router';
import { useMotion } from '@/providers/MotionProvider';
import { usePageQuery } from '@/providers/PagePrefsProvider';

type NoteView = 'list' | 'grid';

export const NOTE_VIEWS: readonly ViewOption<NoteView>[] = [
  { id: 'list', label: 'List', icon: RowsIcon },
  { id: 'grid', label: 'Grid', icon: SquaresFourIcon },
];

/** The gap between Grid's cards, px (`gap-3`). */
const GRID_GAP = 12;

/** The Notepad first, then pinned (Grid), then newest. */
function ordered(notes: Note[], pinnedFirst: boolean): Note[] {
  return [...notes].sort(
    (a, b) =>
      Number(Boolean(b.scratch)) - Number(Boolean(a.scratch)) ||
      (pinnedFirst ? Number(b.pinned) - Number(a.pinned) : 0),
  );
}

/**
 * The project a new note starts in from Notes: the filtered one, or
 * General (`null`) when the filter is All projects or General.
 */
export function notesPreset(project: string | null | undefined): string | null {
  return project && project !== 'general' ? project : null;
}

/**
 * The view's controls, from the URL so Back restores them, over what is
 * saved for the page (never the Find text).
 */
function useNoteFilters(query: URLSearchParams): NoteFilters {
  const value = query.toString();
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
 * Notes as a List (the default: the compact note row under day headings,
 * newest first, each opening in place) or a Grid (compact cards in masonry columns,
 * pinned first, opening in place) (#218). The Notepad's note comes first
 * in both, and opens its own page, `/notepad` (#261). Add note opens the
 * new-note panel, preset to the filtered project (General otherwise), as
 * `N` does here; then a project filter, Pinned and Find. Filters and
 * layout live in the URL, and all but Find are saved for the page (#186).
 * `?note=<id>` (a link to one note) shows it opened in the List; the
 * Notepad's goes to its page.
 */
export function NotesPage() {
  usePageTitle('Notes');
  const { state } = useDatapad();
  const { hidden, newNote } = useNotes();
  const { active } = useMotion();
  const [query, changePage] = usePageQuery('notes');
  const filters = useNoteFilters(query);
  const [view, setView] = useView('notes', NOTE_VIEWS, 'list');
  const target = useQuery().get('note');
  const padId = state ? notepadOf(state.notes)?.id : undefined;
  // A link to the Notepad's note opens the Notepad.
  useEffect(() => {
    if (target && target === padId) {
      navigate({ name: 'notepad' }, { replace: true });
    }
  }, [target, padId]);
  const [open, setOpen] = useState<string | null>(null);
  const feed = useRef<HTMLDivElement>(null);
  useFlip(feed, active);

  const changeQuery = useCallback(
    (changes: Record<string, string | null>) =>
      changePage(changes, {
        transition: (update) => withViewTransition(update, active, 'filter'),
      }),
    [active, changePage],
  );
  const listFilters = useListFilters('notes', query, changeQuery);

  const notes = useMemo(
    () => (state ? selectNotes(state, filters, hidden) : []),
    [state, filters, hidden],
  );
  const list = useMemo(() => ordered(notes, false), [notes]);
  const grid = useMemo(() => ordered(notes, true), [notes]);

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
  useMasonry(gridRef, GRID_GAP, view === 'grid' ? grid : null);
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
  const any = Object.keys(state.notes).length > hidden.size;
  const filterProject = notesPreset(filters.project);

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
        <Button
          className="press h-11 desk:h-8"
          onClick={() => newNote(filterProject)}
        >
          <PlusIcon />
          Add note
        </Button>
      </div>

      <ListToolbar
        state={listFilters}
        find={
          <FindField
            value={filters.q}
            placeholder="Words in a note, or a name"
            onChange={(q) => changePage({ q: q || null }, { replace: true })}
          />
        }
        filters={
          <>
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
              onChange={(v) =>
                changeQuery({ pinned: v === 'pinned' ? '1' : null })
              }
              options={[
                { value: 'all', label: 'All' },
                { value: 'pinned', label: 'Pinned' },
              ]}
            />
          </>
        }
      />

      <div ref={feed} className="vt-list flex flex-col gap-6">
        {notes.length === 0 ? (
          <ListEmpty
            state={any ? listFilters : { ...listFilters, filtered: false }}
          >
            No notes yet. Add note writes one, or write in the Notepad.
          </ListEmpty>
        ) : view === 'grid' ? (
          <ul
            ref={gridRef}
            aria-label="Notes"
            style={{ paddingBottom: overhang }}
            className="relative flex flex-col gap-3"
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
                <li
                  key={n.id}
                  className={isOpen ? 'relative z-20' : 'relative'}
                >
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
          <NoteList
            notes={list}
            state={state}
            today={today}
            highlight={words}
          />
        )}
      </div>
    </section>
  );
}

import {
  CaretDownIcon,
  PencilSimpleIcon,
  PushPinIcon,
  PushPinSlashIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toggleCheck } from '#shared/markdown';
import {
  type PinnedNote,
  pinnedBody,
  pinnedFit,
  withNoteQuery,
} from '#shared/rooms';
import type { Note, Person } from '#shared/types';
import { Markdown } from '@/components/Markdown';
import { NoteEditor, useNoteActions } from '@/components/notes/noteParts';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDatapad } from '@/hooks/useDatapad';
import { linkProps, navigate, type Route } from '@/lib/router';
import { cn } from '@/lib/utils';
import { useToast } from '@/providers/ToastProvider';

/*
 * Pinned notes at the top of a room (#377): each of the room's pinned
 * notes in its tab row after the tabs, labeled by its first line, and
 * the one chosen open at the top of the room, on whatever tab is
 * current. The address holds it (`?note=`), so Back closes it.
 */

/** A pinned note's link in the tab row: a tab's look, with a pin. */
const PIN =
  'inline-flex h-11 max-w-48 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 text-sm text-muted-foreground outline-ring/50 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 desk:h-9';
/** The space between two of them (`gap-1`). */
const GAP = 4;

/**
 * The room's pinned notes in its tab row: as many as fit, in order, and
 * the rest under a Pinned menu at the end, so the row never scrolls.
 * The open one (`open`) carries `aria-current`; choosing it again
 * closes it.
 */
export function PinnedNotesNav({
  notes,
  open,
  route,
  query,
}: {
  notes: readonly PinnedNote[];
  open: string | null;
  /** The room's current tab, which stays put. */
  route: Route;
  /** The current query, kept but for `note`. */
  query: string;
}) {
  const nav = useRef<HTMLElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(notes.length);
  const labels = notes.map((n) => n.label).join('\n');

  // biome-ignore lint/correctness/useExhaustiveDependencies: measures again when the labels change
  useLayoutEffect(() => {
    const row = nav.current;
    const copies = ghost.current;
    if (!row || !copies) return;
    const measure = () => {
      const widths = [...copies.querySelectorAll('[data-ghost-pin]')].map(
        (el) => el.getBoundingClientRect().width + GAP,
      );
      const menu =
        copies.querySelector('[data-ghost-menu]')?.getBoundingClientRect()
          .width ?? 0;
      setFit(pinnedFit(widths, row.clientWidth, menu));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [labels]);

  if (notes.length === 0) return null;
  const shown = notes.slice(0, fit);
  const rest = notes.slice(fit);
  const href = (id: string) => withNoteQuery(query, open === id ? null : id);

  return (
    <nav
      ref={nav}
      aria-label="Pinned notes"
      className="relative flex min-w-0 flex-1 gap-1 overflow-hidden"
    >
      {shown.map((n) => (
        <a
          key={n.id}
          {...linkProps(route, href(n.id))}
          aria-current={open === n.id ? 'true' : undefined}
          data-pinned-note={n.id}
          className={cn(
            PIN,
            open === n.id && 'border-primary font-medium text-foreground',
          )}
        >
          <PushPinIcon weight="fill" aria-hidden className="shrink-0" />
          <span className="truncate">{n.label}</span>
        </a>
      ))}
      {rest.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            data-pinned-menu
            className={cn(
              PIN,
              'press data-popup-open:text-foreground',
              rest.some((n) => n.id === open) &&
                'border-primary font-medium text-foreground',
            )}
          >
            <PushPinIcon weight="fill" aria-hidden className="shrink-0" />
            <span className="sr-only desk:not-sr-only">Pinned</span>
            <span className="count text-xs tabular-nums">{rest.length}</span>
            <CaretDownIcon aria-hidden className="shrink-0" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {rest.map((n) => (
              <DropdownMenuItem
                key={n.id}
                data-pinned-note={n.id}
                aria-current={open === n.id ? 'true' : undefined}
                className={cn(open === n.id && 'font-medium')}
                onClick={() => navigate(route, { query: href(n.id) })}
              >
                <PushPinIcon weight="fill" />
                <span className="truncate">{n.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {/* Unseen copies, to measure what fits. */}
      <div
        ref={ghost}
        aria-hidden
        className="pointer-events-none invisible absolute top-0 left-0 flex"
      >
        {notes.map((n) => (
          <span key={n.id} data-ghost-pin className={PIN}>
            <PushPinIcon weight="fill" className="shrink-0" />
            <span className="truncate">{n.label}</span>
          </span>
        ))}
        <span data-ghost-menu className={PIN}>
          <PushPinIcon weight="fill" className="shrink-0" />
          <span className="hidden desk:inline">Pinned</span>
          <span className="text-xs tabular-nums">{notes.length}</span>
          <CaretDownIcon className="shrink-0" />
        </span>
      </div>
    </nav>
  );
}

/**
 * The pinned note open at the top of the room: its label, Edit (in
 * place), Unpin and Close over the rendered note, where checkboxes save.
 * It takes focus as it opens; Esc or Close closes it (the address loses
 * `note`), and focus goes back to its link in the tab row.
 */
export function PinnedNoteView({
  note,
  label,
  people,
  route,
  query,
}: {
  note: Note;
  label: string;
  people: Record<string, Person>;
  route: Route;
  query: string;
}) {
  const { actions } = useDatapad();
  const { show } = useToast();
  const act = useNoteActions(note, people);
  const [editing, setEditing] = useState<string | null>(null);
  const shown = useMemo(
    () => pinnedBody(note.body, people),
    [note.body, people],
  );
  const box = useRef<HTMLElement>(null);
  const headingId = `pinned-note-${note.id}`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: takes focus when another note opens
  useLayoutEffect(() => {
    setEditing(null);
    box.current?.focus({ preventScroll: true });
  }, [note.id]);

  const close = () => {
    navigate(route, { replace: true, query: withNoteQuery(query, null) });
    requestAnimationFrame(() => {
      const link =
        document.querySelector<HTMLElement>(
          `a[data-pinned-note="${CSS.escape(note.id)}"]`,
        ) ?? document.querySelector<HTMLElement>('[data-pinned-menu]');
      link?.focus({ preventScroll: true });
    });
  };

  const unpin = () => {
    if (actions.pinNote({ id: note.id, pinned: false }) === false) return;
    close();
    show(`Unpinned “${label}”`, () =>
      actions.pinNote({ id: note.id, pinned: true }),
    );
  };

  return (
    <section
      ref={box}
      tabIndex={-1}
      aria-labelledby={headingId}
      data-pinned-open={note.id}
      className="enter flex flex-col border border-primary/50 bg-card outline-none focus-visible:outline-2 focus-visible:outline-ring/50"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented && editing === null) {
          e.preventDefault();
          close();
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-1 border-b pr-1 pl-3">
        <h2
          id={headingId}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 text-sm font-medium desk:min-h-9"
        >
          <PushPinIcon weight="fill" aria-hidden className="shrink-0" />
          <span className="sr-only">Pinned note: </span>
          <span className="truncate">{label}</span>
        </h2>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            className="press h-11 desk:h-8"
            disabled={editing !== null}
            onClick={() => setEditing(act.editText())}
          >
            <PencilSimpleIcon />
            Edit
          </Button>
          <Button
            variant="ghost"
            className="press h-11 desk:h-8"
            onClick={unpin}
          >
            <PushPinSlashIcon />
            Unpin
          </Button>
          <Button
            variant="ghost"
            className="press size-11 desk:size-8"
            aria-label="Close pinned note"
            onClick={close}
          >
            <XIcon />
          </Button>
        </div>
      </div>
      <div className="px-3 py-3">
        {editing !== null ? (
          <NoteEditor
            note={note}
            people={people}
            initial={editing}
            onDone={() => {
              setEditing(null);
              box.current?.focus({ preventScroll: true });
            }}
          />
        ) : (
          <div className="note-row-body">
            <Markdown
              text={shown.text}
              people={people}
              onToggle={(line) =>
                actions.editNote({
                  id: note.id,
                  body: toggleCheck(note.body, line + shown.offset),
                })
              }
            />
          </div>
        )}
      </div>
    </section>
  );
}

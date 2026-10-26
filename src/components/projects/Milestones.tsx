import {
  FlagIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';
import { formatDay } from '#shared/dates';
import {
  type DateString,
  type Milestone,
  milestonesOf,
  type Project,
} from '#shared/types';
import { DatePicker } from '@/components/inputs/DatePicker';
import { Section } from '@/components/Section';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDatapad } from '@/hooks/useDatapad';
import { useFlip } from '@/hooks/useFlip';
import { useQuery } from '@/lib/router';
import { cn } from '@/lib/utils';
import { useMotion } from '@/providers/MotionProvider';
import { useToast } from '@/providers/ToastProvider';

const ICON_BUTTON = 'press size-11 shrink-0 desk:size-8';

/**
 * A project's milestones on its page: an add line (title and date; Enter
 * adds, Esc clears), then the milestones by date, past ones muted. Each
 * edits in place (title and date) and deletes with Undo in the toast.
 * `?milestone=<id>` (the Timeline, Focus's agenda) opens the section and
 * brings that one into view.
 */
export function Milestones({
  project,
  today,
  storageKey,
}: {
  project: Project;
  today: DateString;
  storageKey: string;
}) {
  const { actions } = useDatapad();
  const { show } = useToast();
  const { active } = useMotion();
  const milestones = milestonesOf(project);
  const list = useRef<HTMLUListElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const addTitle = useRef<HTMLInputElement>(null);
  useFlip(list, active);
  /** Rows there on the first render: they do not run the entrance. */
  const first = useRef<Set<string> | null>(null);
  if (first.current === null) {
    first.current = new Set(milestones.map((m) => m.id));
  }
  const [editing, setEditing] = useState<string | null>(null);
  /** After an edit closes, focus goes back to that row's Edit. */
  const refocus = useRef<string | null>(null);
  const target = useQuery().get('milestone');
  const [flash, setFlash] = useState<string | null>(null);

  // Arriving from the Timeline or the agenda: bring it into view.
  useEffect(() => {
    if (!target) return;
    const row = list.current?.querySelector<HTMLElement>(
      `[data-milestone-id="${CSS.escape(target)}"]`,
    );
    if (!row) {
      box.current?.scrollIntoView({ block: 'start' });
      return;
    }
    row.scrollIntoView({ block: 'center' });
    row.focus({ preventScroll: true });
    setFlash(target);
    const timer = window.setTimeout(() => setFlash(null), 2400);
    return () => window.clearTimeout(timer);
  }, [target]);

  useEffect(() => {
    if (editing !== null || !refocus.current) return;
    list.current
      ?.querySelector<HTMLElement>(
        `[data-milestone-id="${CSS.escape(refocus.current)}"] [data-edit]`,
      )
      ?.focus();
    refocus.current = null;
  }, [editing]);

  const add = (title: string, date: DateString) =>
    actions.addMilestone({ projectId: project.id, title, date }) !== null;

  const remove = (m: Milestone) => {
    if (!actions.deleteMilestone({ projectId: project.id, id: m.id })) return;
    addTitle.current?.focus();
    show(`Deleted milestone “${m.title}”`, () =>
      actions.addMilestone({
        projectId: project.id,
        id: m.id,
        title: m.title,
        date: m.date,
      }),
    );
  };

  const close = (id: string) => {
    refocus.current = id;
    setEditing(null);
  };

  return (
    <div ref={box} className="scroll-mt-16">
      <Section
        title="Milestones"
        count={milestones.filter((m) => m.date >= today).length}
        storageKey={storageKey}
        open={target !== null || undefined}
      >
        <div className="flex flex-col gap-3 pt-2">
          <AddMilestone input={addTitle} onAdd={add} />
          {milestones.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No milestones. Add one above.
            </p>
          ) : (
            <ul
              ref={list}
              aria-label={`Milestones in ${project.name}`}
              className="flex flex-col border-t"
            >
              {milestones.map((m) => {
                const past = m.date < today;
                return (
                  <li
                    key={m.id}
                    tabIndex={-1}
                    data-flip-id={m.id}
                    data-milestone-id={m.id}
                    data-past={past || undefined}
                    data-highlighted={flash === m.id || undefined}
                    className={cn(
                      'milestone-row row flex items-center gap-2 border-b px-1 text-sm outline-none',
                      past && 'text-muted-foreground',
                      !first.current?.has(m.id) && 'enter',
                    )}
                  >
                    {editing === m.id ? (
                      <EditMilestone
                        milestone={m}
                        onSave={(patch) => {
                          if (
                            Object.keys(patch).length === 0 ||
                            actions.editMilestone({
                              projectId: project.id,
                              id: m.id,
                              patch,
                            })
                          ) {
                            close(m.id);
                          }
                        }}
                        onCancel={() => close(m.id)}
                      />
                    ) : (
                      <>
                        <FlagIcon
                          aria-hidden
                          weight={past ? 'regular' : 'fill'}
                          className="shrink-0"
                        />
                        <span className="w-24 shrink-0 text-xs tabular-nums desk:w-28">
                          {formatDay(m.date, today)}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {past && <span className="sr-only">Past: </span>}
                          {m.title}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          data-edit
                          className={ICON_BUTTON}
                          aria-label={`Edit “${m.title}”`}
                          onClick={() => setEditing(m.id)}
                        >
                          <PencilSimpleIcon />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={ICON_BUTTON}
                          aria-label={`Delete “${m.title}”`}
                          onClick={() => remove(m)}
                        >
                          <TrashIcon />
                        </Button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Section>
    </div>
  );
}

/** Esc from a field (not from the calendar popover above it). */
function isFieldEscape(event: React.KeyboardEvent): boolean {
  return (
    event.key === 'Escape' &&
    event.target instanceof HTMLInputElement &&
    event.currentTarget.contains(event.target)
  );
}

/**
 * The add line: a title and a date. Enter adds (and keeps focus in the
 * title for the next one); Esc clears both. The date commits on Enter
 * before the form submits, so it is read from a ref, not state.
 */
function AddMilestone({
  input,
  onAdd,
}: {
  input: React.RefObject<HTMLInputElement | null>;
  onAdd: (title: string, date: DateString) => boolean;
}) {
  const id = useId();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState<DateString | ''>('');
  const latest = useRef<DateString | ''>('');
  /** Remounts the date field, which also drops text it could not read. */
  const [round, setRound] = useState(0);

  const clear = () => {
    setTitle('');
    setDate('');
    latest.current = '';
    setRound((r) => r + 1);
  };

  return (
    <form
      aria-label="Add a milestone"
      className="flex flex-col gap-2 desk:flex-row desk:items-start"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim()) {
          input.current?.focus();
          return;
        }
        if (!latest.current) {
          document.getElementById(`${id}-date`)?.focus();
          return;
        }
        if (onAdd(title.trim(), latest.current)) clear();
        input.current?.focus();
      }}
      onKeyDown={(event) => {
        if (isFieldEscape(event) && (title || latest.current)) {
          event.preventDefault();
          event.stopPropagation();
          clear();
          input.current?.focus();
        }
      }}
    >
      <div className="relative flex-1">
        <PlusIcon
          weight="bold"
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={input}
          aria-label="Milestone title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a milestone"
          autoComplete="off"
          enterKeyHint="done"
          className="h-11 pl-8 text-base desk:h-8 desk:text-xs"
        />
      </div>
      <DatePicker
        key={round}
        id={`${id}-date`}
        label="Milestone date"
        value={date}
        onChange={(next) => {
          latest.current = next;
          setDate(next);
        }}
        className="desk:w-56"
      />
      <Button type="submit" variant="outline" className="press h-11 desk:h-8">
        Add
      </Button>
    </form>
  );
}

/** A row in edit mode: title and date; Enter saves, Esc cancels. */
function EditMilestone({
  milestone,
  onSave,
  onCancel,
}: {
  milestone: Milestone;
  onSave: (patch: { title?: string; date?: DateString }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(milestone.title);
  const [date, setDate] = useState<DateString | ''>(milestone.date);
  const latest = useRef<DateString | ''>(milestone.date);
  const titleInput = useRef<HTMLInputElement>(null);

  return (
    <form
      aria-label={`Edit milestone “${milestone.title}”`}
      className="flex w-full flex-col gap-2 py-2 desk:flex-row desk:items-start"
      onSubmit={(event) => {
        event.preventDefault();
        const next = title.trim();
        if (!next) {
          titleInput.current?.focus();
          return;
        }
        const patch: { title?: string; date?: DateString } = {};
        if (next !== milestone.title) patch.title = next;
        // Clearing the date keeps the one it had: a milestone has a day.
        if (latest.current && latest.current !== milestone.date) {
          patch.date = latest.current;
        }
        onSave(patch);
      }}
      onKeyDown={(event) => {
        if (isFieldEscape(event)) {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <Input
        ref={titleInput}
        autoFocus
        aria-label="Milestone title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoComplete="off"
        enterKeyHint="done"
        className="h-11 flex-1 text-base desk:h-8 desk:text-xs"
      />
      <DatePicker
        label="Milestone date"
        value={date}
        onChange={(next) => {
          latest.current = next;
          setDate(next);
        }}
        className="desk:w-56"
      />
      <div className="flex gap-1">
        <Button type="submit" className="press h-11 flex-1 desk:h-8">
          Save
        </Button>
        <Button
          type="button"
          variant="outline"
          className="press h-11 flex-1 desk:h-8"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

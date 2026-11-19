import { ArrowsOutSimpleIcon, PlusIcon } from '@phosphor-icons/react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type CaptureContext,
  type CaptureKind,
  canSave,
  captureChips,
  captureOps,
  captureToast,
  hashQuery,
  KIND_LABELS,
  newProjectFor,
  nextKind,
  parseCapture,
  projectsFor,
  projectWord,
  slashKind,
  undoCaptureOp,
} from '#shared/capture';
import { COMMANDS, isCreateCommand } from '#shared/composer';
import { mentionMatches, mentionQuery, tokensToNames } from '#shared/mentions';
import { planInlineAdd } from '#shared/people';
import type { Snapshot } from '#shared/types';
import { useNotes } from '@/components/notes/NotesProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDatapad } from '@/hooks/useDatapad';
import { useToday } from '@/hooks/useNow';
import { CAPTURE_ID, takeCaptureFocus } from '@/lib/capture';
import { newId } from '@/lib/ids';
import { cn } from '@/lib/utils';
import { useToast } from '@/providers/ToastProvider';

/** One row of the `@` or `#` menu. */
interface Option {
  key: string;
  label: string;
  hint?: string;
  /** What it puts in the line in place of the `@query` or `#query`. */
  insert: string;
  /** "Add “…” to People": the name to add first. */
  add?: string;
  /** "Create project “…”": the project to create first. */
  create?: { name: string; org: string; orgId?: string };
}

interface Menu {
  kind: 'people' | 'projects' | 'commands';
  start: number;
  options: Option[];
}

const MENU_MAX = 8;

const MENU_LABELS: Record<Menu['kind'], string> = {
  people: 'People',
  projects: 'Projects',
  commands: 'Commands',
};

/** The create commands (#375), as the capture line's `/` menu lists them. */
const CREATE = COMMANDS.filter((c) => isCreateCommand(c.id));

/**
 * The `/word` being typed at the start of the line, for the command
 * menu: what each command makes, matched by the start of its word or
 * label.
 */
function commandMenu(text: string, caret: number): Menu | null {
  const m = /^\/([a-z]*)$/i.exec(text.slice(0, caret));
  if (!m) return null;
  const query = (m[1] ?? '').toLowerCase();
  const options: Option[] = CREATE.filter(
    (c) => c.id.startsWith(query) || c.label.toLowerCase().startsWith(query),
  ).map((c) => ({
    key: c.id,
    label: `/${c.id}`,
    hint: c.label,
    insert: `/${c.id} `,
  }));
  return options.length > 0 ? { kind: 'commands', start: 0, options } : null;
}

/**
 * The `@` or `#` menu at `caret`: people whose names start with what is
 * typed (and "Add “…” to People" for a name nobody has), or the open
 * projects it could mean (and "Create project “…”" for a word no project
 * is called). Null when there is nothing to offer, or once a known name
 * is followed by more words.
 */
function menuAt(state: Snapshot, text: string, caret: number): Menu | null {
  const command = commandMenu(text, caret);
  if (command) return command;
  const hash = hashQuery(text, caret);
  if (hash) {
    const projects = hash.query
      ? projectsFor(hash.query, state)
      : Object.values(state.projects)
          .filter((p) => !p.archived)
          .sort((a, b) => a.name.localeCompare(b.name));
    const options: Option[] = projects.slice(0, MENU_MAX).map((p) => ({
      key: p.id,
      label: p.name,
      hint: p.org || undefined,
      insert: `${projectWord(p.name)} `,
    }));
    const create = newProjectFor(hash.query, state);
    if (create) {
      options.push({
        key: '\u0000create',
        label: `Create project “${create.name}”`,
        insert: `#${create.name} `,
        create,
      });
    }
    return options.length > 0
      ? { kind: 'projects', start: hash.start, options }
      : null;
  }
  const mention = mentionQuery(text, caret);
  if (!mention) return null;
  const query = mention.query;
  const lower = query.toLowerCase();
  const named = Object.values(state.people).some((p) =>
    lower.startsWith(`${p.name.toLowerCase()} `),
  );
  if (named) return null;
  const options: Option[] = mentionMatches(state.people, query, MENU_MAX).map(
    (p) => ({
      key: p.id,
      label: p.name,
      hint: p.me ? 'you' : p.role || undefined,
      insert: `@${p.name} `,
    }),
  );
  const name = query.trim();
  const plan = planInlineAdd(state.people, name);
  if (
    plan.kind === 'new' &&
    !query.endsWith(' ') &&
    name.split(' ').length <= 3
  ) {
    options.push({
      key: '\u0000add',
      label: `Add “${plan.name}” to People`,
      insert: `@${plan.name} `,
      add: plan.name,
    });
  }
  return options.length > 0
    ? { kind: 'people', start: mention.start, options }
    : null;
}

/**
 * The capture line (#330): one input that works out what a line is and
 * where it goes, with chips that say so. `@` and `#` open a menu of
 * people and projects (an unknown name can be added to People, an
 * unknown `#word` created as a project), `/` at the start a menu of what
 * it can make (#375: `/meeting`, `/person` and the rest), Enter
 * saves and the toast offers Undo, Esc clears, Tab or the kind chip
 * changes what it becomes, and Shift+Enter or the expand button carries
 * it to the full note composer, filed the same way. `n` focuses it.
 */
export function CaptureLine({
  context,
  className,
}: {
  /** A room presets its project or person. */
  context?: CaptureContext;
  className?: string;
}) {
  const { state, actions } = useDatapad();
  const { show } = useToast();
  const { newNote } = useNotes();
  const today = useToday();
  const listId = useId();
  const chipsId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [force, setForce] = useState<CaptureKind | null>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const pendingCaret = useRef<number | null>(null);

  useEffect(() => {
    if (takeCaptureFocus()) input.current?.focus();
  }, []);

  // A picked name puts the caret after it once the new text is in.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the text it waits for arrives
  useLayoutEffect(() => {
    const at = pendingCaret.current;
    if (at === null || !input.current) return;
    pendingCaret.current = null;
    input.current.setSelectionRange(at, at);
    setCaret(at);
  }, [text]);

  const capture = useMemo(
    () =>
      state
        ? parseCapture(text, state, today, context, force ?? undefined)
        : null,
    [text, state, today, context, force],
  );
  const chips = useMemo(
    () =>
      state && capture && text.trim()
        ? captureChips(capture, state, today)
        : [],
    [state, capture, text, today],
  );
  const menu = useMemo(() => {
    if (!state || caret === null) return null;
    const found = menuAt(state, text, caret);
    return found && found.start !== dismissed ? found : null;
  }, [state, text, caret, dismissed]);
  const open = menu !== null;
  const count = menu?.options.length ?? 0;
  const highlighted = Math.min(active, Math.max(count - 1, 0));

  const change = (next: string) => {
    setText(next);
    setActive(0);
    setDismissed(null);
    if (!next.trim()) setForce(null);
  };

  const clear = () => {
    change('');
    input.current?.focus();
  };

  const choose = (index: number) => {
    const option = menu?.options[index];
    if (!menu || !option || caret === null) return;
    if (option.add && actions.addPerson({ name: option.add }) === null) return;
    if (option.create) {
      if (actions.createProject(option.create) === null) return;
      show(`Created ${option.create.name}`);
    }
    const next = text.slice(0, menu.start) + option.insert + text.slice(caret);
    pendingCaret.current = menu.start + option.insert.length;
    change(next);
    input.current?.focus();
  };

  const save = () => {
    if (!state || !capture || !canSave(capture, state)) return;
    const id = newId();
    if (!actions.batch({ ops: captureOps(capture, state, id) })) return;
    const undo = undoCaptureOp(capture.kind, id, capture.projectId);
    show(captureToast(capture, state), () => {
      actions.batch({ ops: [undo] });
    });
    clear();
  };

  /** The text, as a note, in the full composer, filed the same way. */
  const expand = () => {
    if (!state) return;
    const note = parseCapture(text, state, today, context, 'note');
    newNote(note.projectId, tokensToNames(note.text, state.people));
    change('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive((highlighted + step + count) % count);
        return;
      }
      if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault();
        choose(highlighted);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setDismissed(menu?.start ?? null);
        return;
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) expand();
      else save();
      return;
    }
    // With something typed, Tab changes what it becomes; empty, it moves on.
    if (e.key === 'Tab' && !e.shiftKey && text.trim() && capture && !slashed) {
      e.preventDefault();
      setForce(nextKind(capture.kind));
      return;
    }
    if (e.key === 'Escape' && text) {
      e.preventDefault();
      e.stopPropagation();
      clear();
    }
  };

  const track = (el: HTMLInputElement) => {
    setCaret(el.selectionStart === el.selectionEnd ? el.selectionStart : null);
  };

  const kind = capture?.kind ?? 'note';
  /** A `/word` sets the kind; the chip and Tab leave it alone. */
  const slashed = slashKind(text.trim()) !== null;

  return (
    <div data-capture className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center">
        <div className="relative min-w-0 flex-1">
          <label htmlFor={CAPTURE_ID} className="sr-only">
            Capture
          </label>
          <PlusIcon
            weight="bold"
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={input}
            id={CAPTURE_ID}
            value={text}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={
              open ? `${listId}-${highlighted}` : undefined
            }
            aria-describedby={chips.length > 0 ? chipsId : undefined}
            placeholder="Capture: a note, [ ] a task, ? to decide, #project, @person, / to make more"
            autoComplete="off"
            enterKeyHint="done"
            className="h-11 pr-11 pl-8 text-base desk:h-9 desk:pr-9 desk:text-sm"
            onChange={(e) => {
              change(e.target.value);
              track(e.target);
            }}
            onSelect={(e) => track(e.currentTarget)}
            onBlur={() => window.setTimeout(() => setCaret(null), 120)}
            onKeyDown={onKeyDown}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Write a longer note"
            title="Write a longer note (Shift+Enter)"
            className="press absolute top-0 right-0 size-11 text-muted-foreground desk:size-9"
            onClick={expand}
          >
            <ArrowsOutSimpleIcon />
          </Button>
          <div
            id={listId}
            role="listbox"
            aria-label={MENU_LABELS[menu?.kind ?? 'people']}
            hidden={!open}
            className="absolute top-full left-0 z-50 mt-1 max-h-72 w-72 max-w-full overflow-y-auto border bg-popover p-1 text-popover-foreground shadow-md"
          >
            {menu?.options.map((o, i) => (
              <div
                key={o.key}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === highlighted}
                tabIndex={-1}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(i);
                }}
                onKeyDown={() => {}}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center gap-2 px-2 text-sm desk:min-h-8',
                  i === highlighted && 'bg-accent text-accent-foreground',
                )}
              >
                <span className="flex-1 truncate">{o.label}</span>
                {o.hint && (
                  <span className="text-xs text-muted-foreground">
                    {o.hint}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      {chips.length > 0 && (
        <ul
          id={chipsId}
          aria-label="Will be saved as"
          className="flex flex-wrap items-center gap-1.5 text-xs"
        >
          {chips.map((chip) =>
            chip.kind === 'kind' && !slashed ? (
              <li key="kind">
                <button
                  type="button"
                  aria-label={`${KIND_LABELS[kind]}. Change to ${KIND_LABELS[nextKind(kind)]}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setForce(nextKind(kind))}
                  className="press inline-flex h-11 items-center border border-primary bg-primary/10 px-2 font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring desk:h-6"
                >
                  {chip.label}
                </button>
              </li>
            ) : (
              <li
                key={`${chip.kind}:${chip.label}`}
                className={cn(
                  'inline-flex h-6 items-center border px-2',
                  chip.kind === 'scratch'
                    ? 'border-dashed text-muted-foreground'
                    : chip.kind === 'problem'
                      ? 'border-warn text-warn'
                      : chip.kind === 'kind'
                        ? 'border-primary bg-primary/10 font-medium text-foreground'
                        : 'bg-muted text-foreground',
                )}
              >
                {chip.label}
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

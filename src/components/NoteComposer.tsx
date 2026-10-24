import {
  CheckSquareIcon,
  CodeIcon,
  ListBulletsIcon,
  TextBIcon,
  TextHIcon,
  TextItalicIcon,
} from '@phosphor-icons/react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  applyCommand,
  type Command,
  type CommandId,
  continueList,
  type Edit,
  inList,
  matchCommands,
  slashQuery,
  toggleLink,
  toggleWrap,
} from '#shared/composer';
import { localDate } from '#shared/dates';
import { LIMITS } from '#shared/limits';
import { mentionMatches, mentionQuery } from '#shared/mentions';
import type { Person } from '#shared/types';
import { Textarea } from '@/components/ui/textarea';
import { caretPosition } from '@/lib/caret';
import { htmlToMarkdown, looksLikeMarkdown } from '@/lib/paste';
import { cn } from '@/lib/utils';

function readDraft(key: string | undefined): string | null {
  if (!key) return null;
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeDraft(key: string | undefined, value: string) {
  if (!key) return;
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // Private mode: the draft just isn't kept.
  }
}

function now(): { today: string; time: string } {
  const d = new Date();
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return { today: localDate(d), time };
}

type Popup =
  | { kind: 'slash'; start: number; arg: string; items: Command[] }
  | { kind: 'mention'; start: number; items: Person[] };

/**
 * The editor for notes, task details and project descriptions: a textarea
 * (plain Markdown, in the body font) with a `/` command menu, `@`
 * mentions, formatting shortcuts, list continuation, rich-text paste and,
 * with `draftKey`, a draft kept in sessionStorage. Text is edited with
 * names; the caller turns them into `@{id}` tokens on save.
 *
 * Edits go through `insertText`, so the browser's own undo keeps working.
 */
export function NoteComposer({
  value,
  onChange,
  people,
  onSubmit,
  onTask,
  draftKey,
  id,
  label,
  placeholder,
  rows = 3,
  maxLength = LIMITS.bodyMax,
  autoFocus,
  className,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  people: Record<string, Person>;
  /** ⌘/Ctrl+Enter. */
  onSubmit?: () => void;
  /** `/task`: make a task titled with the line. Hidden without it. */
  onTask?: (title: string) => boolean;
  /** Where the unsaved draft lives in sessionStorage. */
  draftKey?: string;
  id?: string;
  /** An accessible name, when no `<label>` points at `id`. */
  label?: string;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  autoFocus?: boolean;
  className?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}) {
  const listId = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const pendingSel = useRef<Edit['sel'] | null>(null);
  const [anchor, setAnchor] = useState({ top: 0, left: 0 });

  // A draft from earlier in this tab comes back once.
  const restored = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on mount
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const draft = readDraft(draftKey);
    if (draft && !value) onChange(draft);
  }, []);
  useEffect(() => {
    if (restored.current) writeDraft(draftKey, value);
  }, [draftKey, value]);

  // A fallback edit (no insertText) puts the selection back once the
  // new text is on screen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the text it waits for arrives
  useLayoutEffect(() => {
    const sel = pendingSel.current;
    if (!sel || !area.current) return;
    pendingSel.current = null;
    area.current.setSelectionRange(sel.start, sel.end);
    setCaret(sel.start === sel.end ? sel.start : null);
  }, [value]);

  const popup = useMemo<Popup | null>(() => {
    if (caret === null) return null;
    const slash = slashQuery(value, caret);
    if (slash && dismissed !== slash.start) {
      const items = matchCommands(slash.query).filter(
        (c) => c.id !== 'task' || onTask,
      );
      if (items.length > 0) {
        const arg = slash.query.split(' ').slice(1).join(' ');
        return { kind: 'slash', start: slash.start, arg, items };
      }
    }
    const mention = mentionQuery(value, caret);
    if (mention && dismissed !== mention.start) {
      const items = mentionMatches(people, mention.query);
      if (items.length > 0) {
        return { kind: 'mention', start: mention.start, items };
      }
    }
    return null;
  }, [caret, value, dismissed, people, onTask]);
  const open = popup !== null;
  const count = popup?.items.length ?? 0;
  const highlighted = Math.min(active, Math.max(count - 1, 0));

  // The menu sits under the caret, inside the field's width.
  useLayoutEffect(() => {
    const el = area.current;
    if (!popup || !el) return;
    const at = caretPosition(el, popup.start);
    const width = Math.min(288, el.clientWidth);
    setAnchor({
      top: el.offsetTop + at.top + at.height + 4,
      left: el.offsetLeft + Math.min(at.left, el.clientWidth - width),
    });
  }, [popup]);

  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (open) list.current?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  /** Replace the text with `edit`, through the browser's undo stack. */
  const apply = (edit: Edit) => {
    const el = area.current;
    if (!el) return;
    const old = el.value;
    const next = edit.text;
    let a = 0;
    while (a < old.length && a < next.length && old[a] === next[a]) a++;
    let b = 0;
    while (
      b < old.length - a &&
      b < next.length - a &&
      old[old.length - 1 - b] === next[next.length - 1 - b]
    ) {
      b++;
    }
    el.focus();
    el.setSelectionRange(a, old.length - b);
    const inserted = next.slice(a, next.length - b);
    let ok = true;
    if (inserted) ok = document.execCommand('insertText', false, inserted);
    else if (old.length - b > a) ok = document.execCommand('delete');
    if (ok && el.value === next) {
      el.setSelectionRange(edit.sel.start, edit.sel.end);
      setCaret(edit.sel.start === edit.sel.end ? edit.sel.start : null);
    } else {
      pendingSel.current = edit.sel;
      onChange(next);
    }
    setActive(0);
    setDismissed(null);
  };

  const sel = () => ({
    start: area.current?.selectionStart ?? 0,
    end: area.current?.selectionEnd ?? 0,
  });

  const command = (id: CommandId, arg = '') => {
    const result = applyCommand(value, sel(), id, now(), arg);
    if (result.task && onTask && !onTask(result.task)) return;
    apply(result);
  };

  const choose = (index: number) => {
    if (!popup || caret === null) return;
    // The typed `/query` or `@query` goes, then the choice applies.
    const text = value.slice(0, popup.start) + value.slice(caret);
    const at = { start: popup.start, end: popup.start };
    if (popup.kind === 'mention') {
      const person = popup.items[index];
      if (!person) return;
      const name = `@${person.name} `;
      apply({
        text: text.slice(0, at.start) + name + text.slice(at.start),
        sel: { start: at.start + name.length, end: at.start + name.length },
      });
      return;
    }
    const cmd = popup.items[index];
    if (!cmd) return;
    const result = applyCommand(text, at, cmd.id, now(), popup.arg);
    if (result.task && onTask && !onTask(result.task)) {
      apply({ text, sel: at });
      return;
    }
    apply(result);
  };

  const track = (el: HTMLTextAreaElement) => {
    setCaret(el.selectionStart === el.selectionEnd ? el.selectionStart : null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (open && !mod) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive((highlighted + step + count) % count);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        choose(highlighted);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setDismissed(popup?.start ?? null);
        return;
      }
    }
    if (mod && e.key === 'Enter') {
      if (onSubmit) {
        e.preventDefault();
        onSubmit();
      }
      return;
    }
    if (mod && e.altKey && !e.shiftKey) {
      const heading = {
        Digit1: 'h1',
        Digit2: 'h2',
        Digit3: 'h3',
        Digit0: 'text',
      }[e.code] as CommandId | undefined;
      if (heading) {
        e.preventDefault();
        command(heading);
      }
      return;
    }
    if (mod && e.shiftKey) {
      if (e.code === 'KeyX') {
        e.preventDefault();
        apply(toggleWrap(value, sel(), '~~'));
        return;
      }
      const list = {
        Digit7: 'numbered',
        Digit8: 'bullet',
        Digit9: 'checklist',
      }[e.code] as CommandId | undefined;
      if (list) {
        e.preventDefault();
        command(list);
      }
      return;
    }
    if (mod) {
      const mark = { b: '**', i: '_', e: '`' }[e.key.toLowerCase()];
      if (mark) {
        e.preventDefault();
        apply(toggleWrap(value, sel(), mark));
        return;
      }
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopPropagation();
        apply(toggleLink(value, sel()));
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      const edit = continueList(value, sel());
      if (edit) {
        e.preventDefault();
        apply(edit);
      }
      return;
    }
    if (e.key === 'Tab' && inList(value, sel())) {
      // Nested lists are not supported; Tab stays put instead of leaving.
      e.preventDefault();
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const html = e.clipboardData.getData('text/html');
    const plain = e.clipboardData.getData('text/plain');
    if (!html || looksLikeMarkdown(plain)) return;
    const markdown = htmlToMarkdown(html);
    if (!markdown || markdown === plain.trim()) return;
    e.preventDefault();
    const { start, end } = sel();
    apply({
      text: value.slice(0, start) + markdown + value.slice(end),
      sel: { start: start + markdown.length, end: start + markdown.length },
    });
  };

  const bar: {
    label: string;
    icon: React.ReactNode;
    run: () => void;
  }[] = [
    {
      label: 'Bold',
      icon: <TextBIcon />,
      run: () => apply(toggleWrap(value, sel(), '**')),
    },
    {
      label: 'Italic',
      icon: <TextItalicIcon />,
      run: () => apply(toggleWrap(value, sel(), '_')),
    },
    {
      label: 'Code',
      icon: <CodeIcon />,
      run: () => apply(toggleWrap(value, sel(), '`')),
    },
    {
      label: 'Bulleted list',
      icon: <ListBulletsIcon />,
      run: () => command('bullet'),
    },
    {
      label: 'Checklist',
      icon: <CheckSquareIcon />,
      run: () => command('checklist'),
    },
    { label: 'Heading', icon: <TextHIcon />, run: () => command('h2') },
    {
      label: 'Commands',
      icon: <span className="font-mono text-sm">/</span>,
      run: () => {
        const { start, end } = sel();
        const before = value.slice(0, start);
        const lead = before === '' || /\s$/.test(before) ? '/' : ' /';
        apply({
          text: before + lead + value.slice(end),
          sel: { start: start + lead.length, end: start + lead.length },
        });
      },
    },
  ];

  return (
    <div className="relative flex flex-col gap-1">
      <fieldset className="format-bar">
        <legend className="sr-only">Formatting</legend>
        {bar.map((b) => (
          <button
            key={b.label}
            type="button"
            aria-label={b.label}
            title={b.label}
            onMouseDown={(e) => e.preventDefault()}
            onClick={b.run}
            className="press inline-flex size-11 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-5"
          >
            {b.icon}
          </button>
        ))}
      </fieldset>
      <Textarea
        ref={area}
        id={id}
        value={value}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={label}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${highlighted}` : undefined}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        autoCapitalize="sentences"
        className={cn(
          'max-h-[60vh] overflow-y-auto text-base desk:text-[15px] desk:leading-[1.45]',
          className,
        )}
        onChange={(e) => {
          onChange(e.target.value);
          track(e.target);
          setActive(0);
          setDismissed(null);
        }}
        onSelect={(e) => track(e.currentTarget)}
        onBlur={() => window.setTimeout(() => setCaret(null), 120)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      />
      <div
        ref={list}
        id={listId}
        role="listbox"
        aria-label={popup?.kind === 'slash' ? 'Commands' : 'People'}
        hidden={!open}
        style={{ top: anchor.top, left: anchor.left }}
        className="absolute z-50 max-h-72 w-72 max-w-full overflow-y-auto border bg-popover p-1 text-popover-foreground shadow-md"
      >
        {popup?.kind === 'slash' &&
          popup.items.map((c, i) => (
            <div
              key={c.id}
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
                'flex min-h-11 cursor-pointer flex-col justify-center px-2 py-1 desk:min-h-9',
                i === highlighted && 'bg-accent text-accent-foreground',
              )}
            >
              <span className="flex items-baseline gap-2 text-sm">
                <span className="flex-1 truncate">{c.label}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {c.markdown}
                </span>
              </span>
              <span className="text-xs text-muted-foreground">
                {c.description}
              </span>
            </div>
          ))}
        {popup?.kind === 'mention' &&
          popup.items.map((p, i) => (
            <div
              key={p.id}
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
              <span className="flex-1 truncate">{p.name}</span>
              {p.role && (
                <span className="text-xs text-muted-foreground">{p.role}</span>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}

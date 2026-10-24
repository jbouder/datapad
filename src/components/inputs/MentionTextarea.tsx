import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { mentionMatches, mentionQuery } from '#shared/mentions';
import type { Person } from '#shared/types';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/**
 * A textarea that suggests people as you type `@`: up to eight whose
 * names start with what follows, under the field. ↑ ↓ move, Enter or Tab
 * inserts `@Name `, Esc closes. The text is edited with names; the caller
 * turns them into `@{id}` tokens on save (`namesToTokens`).
 */
export function MentionTextarea({
  value,
  onChange,
  people,
  className,
  rows = 4,
  maxLength,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  onKeyDown,
}: {
  value: string;
  onChange: (value: string) => void;
  people: Record<string, Person>;
  className?: string;
  rows?: number;
  maxLength?: number;
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
}) {
  const listId = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  /** Where the caret goes once an inserted mention is on screen. */
  const pendingCaret = useRef<number | null>(null);

  // In the same commit as the new text, before the next keystroke can
  // land: a frame later would split whatever was typed in between.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the text it waits for arrives
  useLayoutEffect(() => {
    const at = pendingCaret.current;
    if (at === null || !area.current) return;
    pendingCaret.current = null;
    area.current.setSelectionRange(at, at);
    setCaret(at);
  }, [value]);

  const query = caret === null ? null : mentionQuery(value, caret);
  const matches = useMemo(
    () => (query ? mentionMatches(people, query.query) : []),
    [people, query?.query, query],
  );
  const open =
    query !== null && matches.length > 0 && dismissed !== query.start;
  const list = useRef<HTMLDivElement>(null);

  // Near the bottom of a panel the list would open out of sight.
  useLayoutEffect(() => {
    if (open) list.current?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  const insert = (person: Person) => {
    if (!query || caret === null) return;
    const before = value.slice(0, query.start);
    const after = value.slice(caret);
    const text = `@${person.name} `;
    pendingCaret.current = before.length + text.length;
    onChange(before + text + after);
  };

  const track = (el: HTMLTextAreaElement) => {
    setCaret(el.selectionStart === el.selectionEnd ? el.selectionStart : null);
  };

  return (
    <div className="relative">
      <Textarea
        ref={area}
        id={id}
        value={value}
        rows={rows}
        maxLength={maxLength}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        className={cn('text-base desk:text-sm', className)}
        onChange={(e) => {
          onChange(e.target.value);
          track(e.target);
          setActive(0);
          setDismissed(null);
        }}
        onSelect={(e) => track(e.currentTarget)}
        onBlur={() => window.setTimeout(() => setCaret(null), 120)}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const step = e.key === 'ArrowDown' ? 1 : -1;
              setActive((i) => (i + step + matches.length) % matches.length);
              return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              const person = matches[active];
              if (person && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                insert(person);
                return;
              }
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setDismissed(query?.start ?? null);
              return;
            }
          }
          onKeyDown?.(e);
        }}
      />
      <div
        ref={list}
        id={listId}
        role="listbox"
        aria-label="People"
        hidden={!open}
        className="absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-y-auto border bg-popover p-1 text-popover-foreground shadow-md"
      >
        {matches.map((p, i) => (
          <div
            key={p.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            tabIndex={-1}
            onMouseDown={(e) => {
              e.preventDefault();
              insert(p);
            }}
            onKeyDown={() => {}}
            className={cn(
              'flex min-h-11 cursor-pointer items-center gap-2 px-2 text-sm desk:min-h-8',
              i === active && 'bg-accent text-accent-foreground',
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

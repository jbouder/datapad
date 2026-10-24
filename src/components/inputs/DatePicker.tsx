import { CalendarBlankIcon } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';
import { describeDay, localDate, parseDate } from '#shared/dates';
import type { DateString } from '#shared/types';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * A date you can type: `today`, `tomorrow`, `fri`, `next tue`, `+3d`,
 * `+2w`, `10/31`, `2026-10-31` (see `parseDate`), or empty to clear. The
 * resolved day shows beside it; a calendar popover is there for the mouse.
 * Commits on blur or Enter; text it cannot read is marked invalid and
 * keeps the last good value.
 */
export function DatePicker({
  value,
  onChange,
  onInvalidChange,
  label,
  id,
  className,
  autoFocus,
  'aria-describedby': describedBy,
}: {
  value: DateString | '';
  onChange: (value: DateString | '') => void;
  /** Told when the typed text becomes unreadable, or readable again. */
  onInvalidChange?: (invalid: boolean) => void;
  /** The accessible name when no `<label>` points at the input. */
  label?: string;
  id?: string;
  className?: string;
  autoFocus?: boolean;
  'aria-describedby'?: string;
}) {
  const ownId = useId();
  const inputId = id ?? ownId;
  const resolvedId = `${inputId}-resolved`;
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value);
  const [invalid, setInvalidState] = useState(false);
  const setInvalid = (next: boolean) => {
    setInvalidState(next);
    onInvalidChange?.(next);
  };
  const [open, setOpen] = useState(false);
  const today = localDate(new Date());

  // A new value from outside (the calendar, an undo) replaces the text.
  useEffect(() => {
    setText(value);
    setInvalidState(false);
  }, [value]);

  const commit = () => {
    const parsed = parseDate(text, today);
    if (parsed === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setText(parsed);
    if (parsed !== value) onChange(parsed);
  };

  const preview = invalid ? null : parseDate(text, today);

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex gap-1">
        <Input
          ref={input}
          id={inputId}
          value={text}
          autoFocus={autoFocus}
          aria-label={label}
          aria-invalid={invalid || undefined}
          aria-describedby={
            [describedBy, resolvedId].filter(Boolean).join(' ') || undefined
          }
          placeholder="today, fri, +3d, 10/31"
          autoComplete="off"
          enterKeyHint="done"
          className="h-11 flex-1 text-base desk:h-8 desk:text-xs"
          onChange={(e) => {
            setText(e.target.value);
            if (invalid) setInvalid(false);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit();
              if (parseDate(text, today) === null) e.preventDefault();
            }
          }}
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="press size-11 desk:size-8"
              />
            }
          >
            <CalendarBlankIcon />
            <span className="sr-only">Choose a date</span>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-0">
            <Calendar
              mode="single"
              weekStartsOn={1}
              selected={value ? toDate(value) : undefined}
              defaultMonth={value ? toDate(value) : undefined}
              onSelect={(date) => {
                const next = date ? localDate(date) : '';
                setOpen(false);
                onChange(next);
                input.current?.focus();
              }}
              autoFocus
            />
          </PopoverContent>
        </Popover>
      </div>
      <p
        id={resolvedId}
        aria-live="polite"
        className={cn(
          'min-h-4 text-xs text-muted-foreground',
          invalid && 'text-destructive',
        )}
      >
        {invalid
          ? 'Try “fri”, “+3d”, “10/31” or 2026-10-31'
          : preview
            ? describeDay(preview, today)
            : ''}
      </p>
    </div>
  );
}

/** A local Date at midnight for the calendar. */
function toDate(day: DateString): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

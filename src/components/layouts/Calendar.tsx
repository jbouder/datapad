import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import {
  addDays,
  endOfWeek,
  formatDay,
  localDate,
  weekday,
} from '#shared/dates';
import type { DateString } from '#shared/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface CalendarItem {
  id: string;
  date: DateString;
  /** `HH:MM` or empty. */
  time?: string;
  label: string;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SHOWN = 3;

function monthOf(day: DateString): DateString {
  return `${day.slice(0, 7)}-01`;
}

function shiftMonth(first: DateString, n: number): DateString {
  const [y, m] = first.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

/**
 * A month grid on desktop (up to three items a day, then "+N more") and a
 * week strip on phones, with previous / next / today. The grid is hidden
 * from assistive tech; the period's items are listed for it instead.
 */
export function Calendar({
  label,
  items,
  onOpen,
}: {
  label: string;
  items: CalendarItem[];
  onOpen?: (id: string) => void;
}) {
  const today = localDate(new Date());
  const [month, setMonth] = useState(() => monthOf(today));
  const [week, setWeek] = useState(() => addDays(endOfWeek(today), -6));
  const [expanded, setExpanded] = useState<DateString | null>(null);

  const byDay = useMemo(() => {
    const map = new Map<DateString, CalendarItem[]>();
    for (const item of [...items].sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.time ?? '').localeCompare(b.time ?? ''),
    )) {
      map.set(item.date, [...(map.get(item.date) ?? []), item]);
    }
    return map;
  }, [items]);

  // Six weeks from the Monday on or before the 1st.
  const gridStart = addDays(month, -weekday(month));
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const monthEnd = addDays(shiftMonth(month, 1), -1);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(week, i));

  const listFor = (from: DateString, to: DateString) =>
    items
      .filter((i) => i.date >= from && i.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date));

  const entry = (item: CalendarItem, compact = false) => (
    <button
      key={item.id}
      type="button"
      tabIndex={-1}
      data-layout-id={item.id}
      onClick={() => onOpen?.(item.id)}
      className={cn(
        'block w-full truncate px-1 text-left hover:bg-accent',
        compact ? 'text-[11px]' : 'min-h-11 text-sm',
      )}
    >
      {item.time && (
        <span className="mr-1 text-muted-foreground tabular-nums">
          {item.time}
        </span>
      )}
      {item.label}
    </button>
  );

  const accessibleList = (from: DateString, to: DateString) => (
    <ul
      aria-label={`${label}, as a list`}
      className="sr-only flex-col gap-1 border p-2 text-sm focus-within:not-sr-only focus-within:flex"
    >
      {listFor(from, to).map((i) => (
        <li key={i.id}>
          {formatDay(i.date, today)}
          {i.time && `, ${i.time}`}:{' '}
          {onOpen ? (
            <button
              type="button"
              className="underline"
              onClick={() => onOpen(i.id)}
            >
              {i.label}
            </button>
          ) : (
            i.label
          )}
        </li>
      ))}
      {listFor(from, to).length === 0 && <li>Nothing in this period.</li>}
    </ul>
  );

  return (
    <section
      aria-label={label}
      className="vt-list relative flex flex-col gap-2"
    >
      {/* Desktop: the month. */}
      <div className="hidden flex-col gap-2 desk:flex">
        <div className="flex items-center gap-2">
          <h3
            className="flex-1 font-heading text-base font-semibold"
            aria-live="polite"
          >
            {MONTHS[m - 1]} {y}
          </h3>
          <Button
            variant="outline"
            size="sm"
            className="press"
            onClick={() => setMonth(monthOf(today))}
          >
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="press"
            onClick={() => setMonth(shiftMonth(month, -1))}
          >
            <CaretLeftIcon />
            <span className="sr-only">Previous month</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="press"
            onClick={() => setMonth(shiftMonth(month, 1))}
          >
            <CaretRightIcon />
            <span className="sr-only">Next month</span>
          </Button>
        </div>
        {accessibleList(month, monthEnd)}
        <div aria-hidden className="grid grid-cols-7 border-t border-l">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="border-r border-b px-1 py-1 text-[11px] text-muted-foreground"
            >
              {d}
            </div>
          ))}
          {cells.map((day) => {
            const list = byDay.get(day) ?? [];
            const open = expanded === day;
            const inMonth = day >= month && day <= monthEnd;
            return (
              <div
                key={day}
                className={cn(
                  'flex min-h-24 flex-col gap-0.5 border-r border-b p-1',
                  !inMonth && 'bg-muted/30 text-muted-foreground',
                )}
              >
                <span
                  className={cn(
                    'self-end px-1 text-[11px] tabular-nums',
                    day === today &&
                      'bg-foreground font-semibold text-background',
                  )}
                >
                  {Number(day.slice(8))}
                </span>
                {(open ? list : list.slice(0, SHOWN)).map((i) =>
                  entry(i, true),
                )}
                {!open && list.length > SHOWN && (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setExpanded(day)}
                    className="px-1 text-left text-[11px] font-semibold hover:underline"
                  >
                    +{list.length - SHOWN} more
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Phones: the week, as a strip of days. */}
      <div className="flex flex-col gap-2 desk:hidden">
        <div className="flex items-center gap-1">
          <h3
            className="flex-1 font-heading text-sm font-semibold"
            aria-live="polite"
          >
            {formatDay(week, today)} – {formatDay(addDays(week, 6), today)}
          </h3>
          <Button
            variant="outline"
            size="sm"
            className="press min-h-11"
            onClick={() => setWeek(addDays(endOfWeek(today), -6))}
          >
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="press size-11"
            onClick={() => setWeek(addDays(week, -7))}
          >
            <CaretLeftIcon />
            <span className="sr-only">Previous week</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="press size-11"
            onClick={() => setWeek(addDays(week, 7))}
          >
            <CaretRightIcon />
            <span className="sr-only">Next week</span>
          </Button>
        </div>
        {accessibleList(week, addDays(week, 6))}
        <ol aria-hidden className="flex flex-col border-t">
          {weekDays.map((day) => {
            const list = byDay.get(day) ?? [];
            return (
              <li key={day} className="flex gap-3 border-b py-1">
                <span
                  className={cn(
                    'w-14 shrink-0 pt-3 text-xs text-muted-foreground',
                    day === today && 'font-semibold text-foreground',
                  )}
                >
                  {formatDay(day, today).replace(/ \w+$/, '')}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  {list.length === 0 ? (
                    <span className="pt-3 text-xs text-muted-foreground/70">
                      —
                    </span>
                  ) : (
                    list.map((i) => entry(i))
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

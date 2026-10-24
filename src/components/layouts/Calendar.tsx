import { CaretLeftIcon, CaretRightIcon, PlusIcon } from '@phosphor-icons/react';
import { type ReactNode, useMemo, useState } from 'react';
import {
  addDays,
  endOfWeek,
  formatDay,
  localDate,
  longDay,
  weekday,
} from '#shared/dates';
import type { DateString } from '#shared/types';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface CalendarItem {
  id: string;
  date: DateString;
  /** `HH:MM` or empty. */
  time?: string;
  label: string;
  /** The chip's colours (an event's type, say). */
  className?: string;
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
/** Column headers: the short name shown, the full one for `abbr`. */
const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
const SHOWN = 3;

function monthOf(day: DateString): DateString {
  return `${day.slice(0, 7)}-01`;
}

function shiftMonth(first: DateString, n: number): DateString {
  const [y, m] = first.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

function count(n: number, noun: string): string {
  return n === 0 ? `no ${noun}s` : n === 1 ? `1 ${noun}` : `${n} ${noun}s`;
}

/**
 * A month on desktop, as a real table: a header per weekday and a label
 * per day ("Tuesday 28 October, 2 events"). Up to three chips a day, then
 * "+N more", which opens the day in a popover (`renderDay`, or the chips).
 * On phones, a week strip of the same days. With `onAddDay`, each day's
 * number (or a click in its empty space) adds an item on that day.
 */
export function Calendar({
  label,
  items,
  onOpen,
  onAddDay,
  noun = 'item',
  renderDay,
}: {
  label: string;
  items: CalendarItem[];
  onOpen?: (id: string) => void;
  onAddDay?: (day: DateString) => void;
  /** What an item is called: "2 events", "Add an event". */
  noun?: string;
  /** A day's full list, in its popover. */
  renderDay?: (day: DateString, ids: string[]) => ReactNode;
}) {
  const today = localDate(new Date());
  const [month, setMonth] = useState(() => monthOf(today));
  const [week, setWeek] = useState(() => addDays(endOfWeek(today), -6));
  const article = /^[aeiou]/i.test(noun) ? 'an' : 'a';

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
  const weeks = Array.from({ length: 6 }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDays(gridStart, w * 7 + d)),
  );
  const monthEnd = addDays(shiftMonth(month, 1), -1);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(week, i));

  const chip = (item: CalendarItem, compact: boolean) => (
    <button
      key={item.id}
      type="button"
      data-layout-id={item.id}
      onClick={() => onOpen?.(item.id)}
      className={cn(
        'press block w-full truncate border border-transparent px-1 text-left outline-ring/50 hover:underline focus-visible:outline-2',
        compact ? 'min-h-6 text-[11px]' : 'min-h-11 text-sm',
        item.className,
      )}
    >
      {item.time && <span className="mr-1 tabular-nums">{item.time}</span>}
      {item.label}
    </button>
  );

  const more = (day: DateString, list: CalendarItem[]) => (
    <Popover>
      <PopoverTrigger className="press min-h-6 px-1 text-left text-[11px] font-semibold outline-ring/50 hover:underline focus-visible:outline-2">
        +{list.length - SHOWN} more
        <span className="sr-only"> on {longDay(day, today)}</span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-[min(32rem,70vh)] w-[min(34rem,90vw)] gap-1 overflow-y-auto"
      >
        <p className="font-heading text-sm font-semibold">
          {longDay(day, today)}
        </p>
        {renderDay
          ? renderDay(
              day,
              list.map((i) => i.id),
            )
          : list.map((i) => chip(i, false))}
      </PopoverContent>
    </Popover>
  );

  const addButton = (day: DateString, className: string, text: ReactNode) =>
    onAddDay ? (
      <button
        type="button"
        onClick={() => onAddDay(day)}
        className={cn(
          'press outline-ring/50 hover:bg-accent focus-visible:outline-2',
          className,
        )}
      >
        {text}
        <span className="sr-only">
          Add {article} {noun} on {longDay(day, today)}
        </span>
      </button>
    ) : (
      <span aria-hidden className={className}>
        {text}
      </span>
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
        <table
          aria-label={`${label}, ${MONTHS[m - 1]} ${y}`}
          className="w-full table-fixed border-collapse"
        >
          <thead>
            <tr>
              {WEEKDAYS.map((d) => (
                <th
                  key={d}
                  scope="col"
                  abbr={d}
                  className="border px-1 py-1 text-left text-[11px] font-normal text-muted-foreground"
                >
                  {d.slice(0, 3)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((days) => (
              <tr key={days[0]}>
                {days.map((day) => {
                  const list = byDay.get(day) ?? [];
                  const inMonth = day >= month && day <= monthEnd;
                  return (
                    // biome-ignore lint/a11y/useKeyWithClickEvents: a mouse shortcut; the day's number is the keyboard path
                    <td
                      key={day}
                      aria-label={`${longDay(day, today)}, ${count(list.length, noun)}`}
                      aria-current={day === today ? 'date' : undefined}
                      onClick={(e) => {
                        if (e.target === e.currentTarget) onAddDay?.(day);
                      }}
                      className={cn(
                        'h-28 border p-1 align-top',
                        !inMonth && 'bg-muted/30 text-muted-foreground',
                        onAddDay && 'cursor-cell',
                      )}
                    >
                      <div className="flex flex-col gap-0.5">
                        {addButton(
                          day,
                          cn(
                            'flex min-h-6 min-w-6 items-center justify-center self-end px-1 text-[11px] tabular-nums',
                            day === today &&
                              'bg-foreground font-semibold text-background hover:bg-foreground/80',
                          ),
                          <span aria-hidden>{Number(day.slice(8))}</span>,
                        )}
                        {list.slice(0, SHOWN).map((i) => chip(i, true))}
                        {list.length > SHOWN && more(day, list)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
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
        <ol
          aria-label={`${label}, this week`}
          className="flex flex-col border-t"
        >
          {weekDays.map((day) => {
            const list = byDay.get(day) ?? [];
            return (
              <li
                key={day}
                aria-label={`${longDay(day, today)}, ${count(list.length, noun)}`}
                aria-current={day === today ? 'date' : undefined}
                className="flex gap-2 border-b py-1"
              >
                <span
                  aria-hidden
                  className={cn(
                    'w-14 shrink-0 pt-3 text-xs text-muted-foreground',
                    day === today && 'font-semibold text-foreground',
                  )}
                >
                  {formatDay(day, today).replace(/ \w+$/, '')}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  {list.length === 0 ? (
                    <span
                      aria-hidden
                      className="pt-3 text-xs text-muted-foreground/70"
                    >
                      —
                    </span>
                  ) : (
                    list.map((i) => chip(i, false))
                  )}
                </div>
                {onAddDay &&
                  addButton(
                    day,
                    'flex size-11 shrink-0 items-center justify-center',
                    <PlusIcon aria-hidden />,
                  )}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

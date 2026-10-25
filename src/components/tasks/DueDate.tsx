import { addDays, formatDay } from '#shared/dates';
import type { DateString } from '#shared/types';
import { cn } from '@/lib/utils';

export type DueState = 'overdue' | 'today' | 'soon' | 'none';

export function dueState(due: DateString | '', today: DateString): DueState {
  if (!due) return 'none';
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  return 'soon';
}

/** "Overdue · Tue 20 Oct", "Today", "Tomorrow", "Fri 30 Oct". */
export function dueLabel(due: DateString, today: DateString): string {
  const state = dueState(due, today);
  if (state === 'today') return 'Today';
  if (due === addDays(today, 1)) return 'Tomorrow';
  const day = formatDay(due, today);
  return state === 'overdue' ? `Overdue · ${day}` : day;
}

/**
 * A task's due date, in words as well as color: destructive when overdue,
 * warn when today. Done tasks are never overdue.
 */
export function DueDate({
  due,
  today,
  done = false,
  className,
}: {
  due: DateString;
  today: DateString;
  done?: boolean;
  className?: string;
}) {
  const state = done ? 'soon' : dueState(due, today);
  return (
    <span
      className={cn(
        'text-xs whitespace-nowrap tabular-nums',
        state === 'overdue' && 'font-medium text-destructive',
        state === 'today' && 'font-medium text-warn',
        state === 'soon' && 'text-muted-foreground',
        className,
      )}
    >
      {done ? formatDay(due, today) : dueLabel(due, today)}
    </span>
  );
}

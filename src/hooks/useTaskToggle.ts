import { useCallback, useEffect, useRef, useState } from 'react';
import type { Task } from '#shared/types';
import { useDatapad } from '@/hooks/useDatapad';
import { useMotion } from '@/providers/MotionProvider';
import { useToast } from '@/providers/ToastProvider';

/** How long the checkbox animates before the row moves (`--duration-base`). */
const CHECK_MS = 200;

/**
 * Close or reopen a task the way a row does it: the checkbox fills at once,
 * the op goes after the check has animated (immediately with motion off),
 * and the toast offers Undo. Undo is the opposite toggle, so a close then
 * undo leaves "Closed …" and "Reopened …" in the activity log; that is the
 * honest record and it is what the spec's log already allows.
 */
export function useTaskToggle() {
  const { actions } = useDatapad();
  const { show } = useToast();
  const { active } = useMotion();
  /** Tasks shown in their new state while the check animates. */
  const [settling, setSettling] = useState<Record<string, boolean>>({});
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
    };
  }, []);

  const toggle = useCallback(
    (task: Task) => {
      const done = task.status !== 'done';
      const send = () => {
        timers.current.delete(task.id);
        setSettling(({ [task.id]: _, ...rest }) => rest);
        if (!actions.toggleTask({ id: task.id, done })) return;
        show(`${done ? 'Closed' : 'Reopened'} “${task.title}”`, () => {
          actions.toggleTask({ id: task.id, done: !done });
        });
      };
      if (!active) {
        send();
        return;
      }
      setSettling((s) => ({ ...s, [task.id]: done }));
      window.clearTimeout(timers.current.get(task.id));
      timers.current.set(task.id, window.setTimeout(send, CHECK_MS));
    },
    [actions, show, active],
  );

  /** Whether a row should show as done right now. */
  const isDone = useCallback(
    (task: Task) => settling[task.id] ?? task.status === 'done',
    [settling],
  );

  return { toggle, isDone };
}

import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { LIMITS } from '#shared/limits';
import { blockedOf, type Task } from '#shared/types';
import { Field } from '@/components/Field';
import { PersonPicker } from '@/components/pickers/PersonPicker';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useDatapad } from '@/hooks/useDatapad';
import { useToast } from '@/providers/ToastProvider';

/**
 * "Mark blocked…": one small dialog for the app (who it waits on, and a
 * one-line reason), opened from a row's ⋯ menu, its lock, or `b`.
 * Unblocking needs no dialog; the toast carries Undo.
 */

interface Blocking {
  /** Open the dialog for a task, blocked or not. */
  editBlocked: (task: Task) => void;
  /** `b`: unblock a blocked task, or ask who an unblocked one waits on. */
  toggleBlocked: (task: Task) => void;
  unblock: (task: Task) => void;
}

const Context = createContext<Blocking | null>(null);

export function BlockedProvider({ children }: { children: ReactNode }) {
  const { actions } = useDatapad();
  const { show } = useToast();
  const [task, setTask] = useState<Task | null>(null);
  const [on, setOn] = useState('');
  const [note, setNote] = useState('');

  const editBlocked = useCallback((t: Task) => {
    const b = blockedOf(t);
    setOn(b?.on ?? '');
    setNote(b?.note ?? '');
    setTask(t);
  }, []);

  const unblock = useCallback(
    (t: Task) => {
      const before = blockedOf(t);
      if (!before) return;
      if (!actions.setBlocked({ id: t.id, blocked: null })) return;
      show(`Unblocked “${t.title}”`, () =>
        actions.setBlocked({ id: t.id, blocked: before }),
      );
    },
    [actions, show],
  );

  const toggleBlocked = useCallback(
    (t: Task) => (blockedOf(t) ? unblock(t) : editBlocked(t)),
    [unblock, editBlocked],
  );

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!task) return;
    const ok = actions.setBlocked({
      id: task.id,
      blocked: { on: on || null, note: note.trim() },
    });
    if (ok) setTask(null);
  };

  const value = useMemo(
    () => ({ editBlocked, toggleBlocked, unblock }),
    [editBlocked, toggleBlocked, unblock],
  );
  const wasBlocked = task ? blockedOf(task) !== null : false;

  return (
    <Context.Provider value={value}>
      {children}
      <Dialog
        open={task !== null}
        onOpenChange={(open) => {
          if (!open) setTask(null);
        }}
      >
        <DialogContent>
          <form onSubmit={save} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Blocked</DialogTitle>
              <DialogDescription>
                “{task?.title}” waits on someone or something.
              </DialogDescription>
            </DialogHeader>
            <Field label="Waiting on">
              <PersonPicker
                value={on}
                onChange={setOn}
                noneLabel="No one listed"
                allowCreate
              />
            </Field>
            <Field label="What for" hint="One line, optional.">
              <Input
                value={note}
                maxLength={LIMITS.blockedNoteMax}
                autoComplete="off"
                onChange={(e) => setNote(e.target.value)}
                className="h-11 text-base desk:h-8 desk:text-xs"
              />
            </Field>
            <DialogFooter>
              {wasBlocked && task && (
                <Button
                  type="button"
                  variant="ghost"
                  className="press mr-auto"
                  onClick={() => {
                    unblock(task);
                    setTask(null);
                  }}
                >
                  Unblock
                </Button>
              )}
              <DialogClose render={<Button type="button" variant="outline" />}>
                Cancel
              </DialogClose>
              <Button type="submit" className="press">
                {wasBlocked ? 'Save' : 'Mark blocked'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Context.Provider>
  );
}

export function useBlocked(): Blocking {
  const value = useContext(Context);
  if (!value) throw new Error('useBlocked needs BlockedProvider');
  return value;
}

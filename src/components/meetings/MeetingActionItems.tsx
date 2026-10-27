import { PlusIcon } from '@phosphor-icons/react';
import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { LIMITS } from '#shared/limits';
import { taskNoteCounts, tasksOfMeeting } from '#shared/select';
import type { Meeting } from '#shared/types';
import { useTaskPanels } from '@/components/tasks/TaskPanelProvider';
import { TaskRow, type TaskRowProps } from '@/components/tasks/TaskRow';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { useFlip } from '@/hooks/useFlip';
import { useToday } from '@/hooks/useNow';
import { useTaskToggle } from '@/hooks/useTaskToggle';
import { cn } from '@/lib/utils';
import { useMotion } from '@/providers/MotionProvider';

/**
 * A meeting's action items, on its page and in its panel: the tasks
 * linked to it (`Task.meetingId`), open first, then done (struck
 * through), each the shared task row, which closes and reopens it and
 * opens its panel. They are ordinary tasks, so they also show on Focus,
 * Tasks and the project.
 *
 * The heading has the open count and Add an action item, as Topics has
 * Add topic: the field shows once it is pressed, stays open for the next
 * title after Enter, and Escape closes it.
 */
export function MeetingActionItems({
  meeting,
  headingLevel = 3,
}: {
  meeting: Meeting;
  /** 2 on the meeting's page; 3 in its panel. */
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const { state, actions } = useDatapad();
  const { openTask } = useTaskPanels();
  const { toggle, isDone } = useTaskToggle();
  const { active } = useMotion();
  const list = useRef<HTMLUListElement>(null);
  useFlip(list, active);
  const headingId = useId();
  const addRef = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const today = useToday();

  const tasks = state?.tasks;
  const { open, done } = useMemo(
    () => tasksOfMeeting(tasks ?? {}, meeting.id),
    [tasks, meeting.id],
  );
  const items = [...open, ...done];

  // What was there at first stays still; anything added later enters.
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null) seen.current = new Set(items.map((t) => t.id));

  const onEdit = useCallback<NonNullable<TaskRowProps['onEdit']>>(
    (task, patch) => {
      actions.editTask({ id: task.id, patch });
    },
    [actions],
  );
  const onOpen = useCallback(
    (task: { id: string }) => openTask(task.id),
    [openTask],
  );

  const show = () => {
    if (adding) addRef.current?.focus();
    else setAdding(true);
  };
  const close = () => {
    setAdding(false);
    setDraft('');
    addButton.current?.focus();
  };
  const add = () => {
    const title = draft.trim();
    if (!title) return;
    const id = actions.addTask({
      projectId: meeting.projectId,
      meetingId: meeting.id,
      title,
    });
    if (id === null) return;
    setDraft('');
    setAnnouncement(`Added “${title}”`);
  };

  if (!state) return null;
  // "2 open"; nothing once every one is done.
  const count = open.length > 0 ? `${open.length} open` : '';

  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-baseline gap-2">
          <Heading id={headingId} className="text-xs font-medium">
            Action items
            <span className="sr-only">
              {meeting.title ? ` from “${meeting.title}”` : ''}
            </span>
          </Heading>
          {count && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {count}
            </span>
          )}
        </span>
        <Button
          ref={addButton}
          type="button"
          variant="outline"
          className="press h-11 desk:h-7"
          aria-expanded={adding}
          onClick={show}
        >
          <PlusIcon />
          Add an action item
        </Button>
      </div>
      {items.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">No action items yet</p>
      )}
      {items.length > 0 && (
        <ul
          ref={list}
          aria-labelledby={headingId}
          className="flex min-w-0 flex-col border-t"
        >
          {items.map((task) => (
            <li
              key={task.id}
              data-flip-id={task.id}
              className={cn(!seen.current?.has(task.id) && 'enter')}
            >
              <TaskRow
                task={task}
                done={isDone(task)}
                today={today}
                projects={state.projects}
                people={state.people}
                showProject={false}
                onToggle={toggle}
                onOpen={onOpen}
                onEdit={onEdit}
                noteCount={taskNoteCounts(state.notes).get(task.id)}
              />
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <input
          ref={addRef}
          value={draft}
          maxLength={LIMITS.titleMax}
          autoComplete="off"
          enterKeyHint="enter"
          placeholder="Add an action item"
          aria-label={`Add an action item to “${meeting.title}”`}
          // biome-ignore lint/a11y/noAutofocus: opened by Add an action item.
          autoFocus
          className="enter mt-1 h-11 w-full min-w-0 border border-dashed bg-transparent px-2 text-base outline-ring/50 focus-visible:outline-2 desk:h-8 desk:max-w-md desk:text-sm"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              add();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          }}
        />
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}

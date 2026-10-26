import { ArrowClockwiseIcon, SparkleIcon } from '@phosphor-icons/react';
import { useMemo, useRef, useState } from 'react';
import { formatTimestamp } from '#shared/dates';
import { LIMITS } from '#shared/limits';
import { namesToTokens, tokensToNames } from '#shared/mentions';
import {
  blockedOf,
  type Link,
  type Note,
  type Priority,
  type Task,
} from '#shared/types';
import { Field } from '@/components/Field';
import { DatePicker } from '@/components/inputs/DatePicker';
import { InlineAdd } from '@/components/inputs/InlineAdd';
import { cleanLinks, LinksEditor } from '@/components/inputs/LinksEditor';
import { PriorityPicker } from '@/components/inputs/PriorityPicker';
import { Segmented } from '@/components/inputs/Segmented';
import { TagInput } from '@/components/inputs/TagInput';
import { Markdown } from '@/components/Markdown';
import { NoteComposer } from '@/components/NoteComposer';
import { noteLocation } from '@/components/notes/useMakeTask';
import { PersonPicker } from '@/components/pickers/PersonPicker';
import { ProjectPicker } from '@/components/pickers/ProjectPicker';
import { SidePanel, SidePanelCancel, useDirty } from '@/components/SidePanel';
import { useSummaries } from '@/components/summary/SummaryProvider';
import { TaskNotes } from '@/components/tasks/TaskNotes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useDatapad } from '@/hooks/useDatapad';
import { linkProps } from '@/lib/router';
import { useToast } from '@/providers/ToastProvider';

interface Values {
  title: string;
  projectId: string | null;
  done: boolean;
  priority: Priority;
  due: string;
  assignee: string;
  tags: string[];
  desc: string;
  links: Link[];
  /** Blocked, and on whom and why. */
  blocked: boolean;
  blockedOn: string;
  blockedNote: string;
}

/**
 * One task's full editor. The values are read once when it opens, so a
 * sync in the background never overwrites what you are typing; if the
 * task changes elsewhere meanwhile, a line offers to reload it. Save sends
 * at most one `editTask` (one "Edited task" line), plus `moveTask` when
 * the project changed (logged in both projects) and `toggleTask` when the
 * status did.
 */
export function TaskPanel({
  task,
  open,
  onClose,
  onExited,
}: {
  task: Task;
  open: boolean;
  onClose: () => void;
  onExited: () => void;
}) {
  const { state, actions } = useDatapad();
  const { show } = useToast();
  const { summarize } = useSummaries();
  const people = state?.people ?? {};
  const read = (t: Task): Values => ({
    title: t.title,
    projectId: t.projectId,
    done: t.status === 'done',
    priority: t.priority,
    due: t.due,
    assignee: t.assignee,
    tags: t.tags,
    desc: tokensToNames(t.desc, people),
    links: t.links,
    blocked: blockedOf(t) !== null,
    blockedOn: blockedOf(t)?.on ?? '',
    blockedNote: blockedOf(t)?.note ?? '',
  });
  const [base, setBase] = useState(() => ({ task, values: read(task) }));
  const [values, setValues] = useState(base.values);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [dateInvalid, setDateInvalid] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const dirty = useDirty(values, base.values);
  // A note added to the task bumps only its `updatedAt`: not a change to
  // what is being edited here.
  const changedElsewhere =
    task.updatedAt !== base.task.updatedAt &&
    JSON.stringify({ ...task, updatedAt: '' }) !==
      JSON.stringify({ ...base.task, updatedAt: '' });

  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const tagSuggestions = useMemo(
    () => [
      ...new Set(Object.values(state?.tasks ?? {}).flatMap((t) => t.tags)),
    ],
    [state?.tasks],
  );
  const sourceNote = task.sourceNoteId
    ? state?.notes[task.sourceNoteId]
    : undefined;

  /** The note's place; following it closes the panel unless it has edits. */
  const noteLink = (note: Note) => {
    const { route, query } = noteLocation(note, state ?? { projects: {} });
    const props = linkProps(route, query);
    return {
      href: props.href,
      onClick: (e: React.MouseEvent<HTMLAnchorElement>) => {
        props.onClick(e);
        if (e.defaultPrevented && !dirty) onClose();
      },
    };
  };

  const save = () => {
    const title = values.title.trim();
    if (!title) {
      setTitleError('Give the task a title');
      titleRef.current?.focus();
      return;
    }
    if (dateInvalid) {
      document.getElementById('task-due')?.focus();
      return;
    }
    const fields = {
      title,
      priority: values.priority,
      due: values.due,
      assignee: values.assignee,
      tags: values.tags,
      desc: namesToTokens(values.desc, people),
      links: cleanLinks(values.links),
    };
    const patch = Object.fromEntries(
      Object.entries(fields).filter(
        ([key, value]) =>
          JSON.stringify(value) !== JSON.stringify(task[key as keyof Task]),
      ),
    );
    if (Object.keys(patch).length > 0) {
      if (!actions.editTask({ id: task.id, patch })) return;
    }
    if (values.projectId !== task.projectId) {
      actions.moveTask({ id: task.id, projectId: values.projectId });
    }
    if (values.done !== (task.status === 'done')) {
      actions.toggleTask({ id: task.id, done: values.done });
    }
    const blocked = values.blocked
      ? { on: values.blockedOn || null, note: values.blockedNote.trim() }
      : null;
    if (JSON.stringify(blocked) !== JSON.stringify(blockedOf(task))) {
      actions.setBlocked({ id: task.id, blocked });
    }
    onClose();
    if (dirty) show(`Saved “${title}”`);
  };

  const remove = () => {
    const deleted = task;
    if (!actions.deleteTask({ id: task.id })) return;
    onClose();
    // Undo puts the very same document back: same id, same order.
    show(`Deleted “${deleted.title}”`, () => {
      actions.put({ col: 'tasks', doc: deleted });
    });
  };

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      onExited={onExited}
      title="Task"
      description={task.title}
      dirty={dirty}
      onSubmit={save}
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            className="press"
            onClick={() => summarize({ kind: 'task', id: task.id })}
          >
            <SparkleIcon />
            Summarize
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="press text-destructive"
            onClick={remove}
          >
            Delete
          </Button>
          <span className="flex-1" />
          <SidePanelCancel />
          <Button type="submit" className="press">
            Save
          </Button>
        </>
      }
    >
      {changedElsewhere && (
        <div
          role="status"
          className="flex items-center gap-2 border border-warn/40 bg-warn/10 px-3 py-2 text-sm"
        >
          <span className="flex-1">Updated elsewhere.</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="press"
            onClick={() => {
              const next = { task, values: read(task) };
              setBase(next);
              setValues(next.values);
            }}
          >
            <ArrowClockwiseIcon />
            Reload
          </Button>
        </div>
      )}
      <Field label="Title" required error={titleError}>
        <Input
          ref={titleRef}
          value={values.title}
          maxLength={LIMITS.titleMax}
          autoComplete="off"
          className="h-11 text-base desk:h-8 desk:text-xs"
          onChange={(e) => {
            set('title', e.target.value);
            if (titleError && e.target.value.trim()) setTitleError(null);
          }}
        />
      </Field>
      <Field label="Project">
        <ProjectPicker
          value={values.projectId}
          onChange={(projectId) => set('projectId', projectId)}
        />
      </Field>
      <Segmented
        legend="Status"
        value={values.done ? 'done' : 'open'}
        onChange={(v) => set('done', v === 'done')}
        options={[
          { value: 'open', label: 'Open' },
          { value: 'done', label: 'Done' },
        ]}
      />
      <PriorityPicker
        value={values.priority}
        onChange={(priority) => set('priority', priority)}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Due">
          <DatePicker
            id="task-due"
            value={values.due}
            onChange={(due) => set('due', due)}
            onInvalidChange={setDateInvalid}
          />
        </Field>
        <AssigneeField
          value={values.assignee}
          onChange={(assignee) => set('assignee', assignee)}
        />
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">Blocked</legend>
        <label
          htmlFor="task-blocked"
          className="flex min-h-11 items-center justify-between gap-4 text-sm desk:min-h-8"
        >
          <span className="flex flex-col">
            <span className="font-medium">Blocked</span>
            <span className="text-xs text-muted-foreground">
              Waiting on someone or something.
            </span>
          </span>
          <Switch
            id="task-blocked"
            checked={values.blocked}
            onCheckedChange={(on) => set('blocked', on)}
          />
        </label>
        {values.blocked && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Waiting on">
              <PersonPicker
                value={values.blockedOn}
                onChange={(id) => set('blockedOn', id)}
                noneLabel="No one listed"
                allowCreate
              />
            </Field>
            <Field label="What for">
              <Input
                value={values.blockedNote}
                maxLength={LIMITS.blockedNoteMax}
                autoComplete="off"
                onChange={(e) => set('blockedNote', e.target.value)}
                className="h-11 text-base desk:h-8 desk:text-xs"
              />
            </Field>
          </div>
        )}
      </fieldset>
      <Field label="Tags">
        <TagInput
          value={values.tags}
          onChange={(tags) => set('tags', tags)}
          suggestions={tagSuggestions}
        />
      </Field>
      <Field label="Details" hint="Markdown; type / for styles, @ to mention">
        <NoteComposer
          value={values.desc}
          onChange={(desc) => set('desc', desc)}
          people={people}
          maxLength={LIMITS.bodyMax}
          rows={6}
        />
      </Field>
      {state && <TaskNotes task={task} state={state} />}
      <LinksEditor
        value={values.links}
        onChange={(links) => set('links', links)}
      />
      {task.sourceNoteId && (
        <section aria-labelledby="source-note" className="flex flex-col gap-1">
          <h3 id="source-note" className="text-xs font-medium">
            From note
          </h3>
          {sourceNote ? (
            <>
              <blockquote className="line-clamp-6 border-l-2 pl-3">
                <Markdown text={sourceNote.body} people={people} />
              </blockquote>
              <a
                {...noteLink(sourceNote)}
                className="self-start text-sm underline underline-offset-4 hover:text-foreground"
              >
                Show the note
              </a>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Note deleted</p>
          )}
        </section>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <dt>Created</dt>
        <dd>{formatTimestamp(task.createdAt)}</dd>
        {task.completedAt && (
          <>
            <dt>Closed</dt>
            <dd>{formatTimestamp(task.completedAt)}</dd>
          </>
        )}
      </dl>
    </SidePanel>
  );
}

/**
 * A new task with more than a title: project (preset to where you are),
 * priority, due, assignee and details. The + button opens it, and `n`
 * where there is no quick-add.
 */
export function NewTaskPanel({
  projectId,
  title = '',
  open,
  onClose,
  onExited,
}: {
  projectId: string | null;
  /** Prefilled (a meeting topic's Make a task). */
  title?: string;
  open: boolean;
  onClose: () => void;
  onExited: () => void;
}) {
  const { state, actions } = useDatapad();
  const { show } = useToast();
  const people = state?.people ?? {};
  const [initial] = useState(() => ({
    title,
    projectId,
    priority: 'none' as Priority,
    due: '',
    assignee: '',
    desc: '',
  }));
  const [values, setValues] = useState(initial);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [dateInvalid, setDateInvalid] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const dirty = useDirty(values, initial);
  const set = <K extends keyof typeof values>(
    key: K,
    value: (typeof values)[K],
  ) => setValues((v) => ({ ...v, [key]: value }));

  const create = () => {
    const title = values.title.trim();
    if (!title) {
      setTitleError('Give the task a title');
      titleRef.current?.focus();
      return;
    }
    if (dateInvalid) {
      document.getElementById('new-task-due')?.focus();
      return;
    }
    const id = actions.addTask({
      title,
      projectId: values.projectId,
      priority: values.priority,
      due: values.due,
      assignee: values.assignee,
      desc: namesToTokens(values.desc, people),
    });
    if (!id) return;
    onClose();
    const where = values.projectId
      ? state?.projects[values.projectId]?.name
      : 'General';
    show(`Added “${title}” to ${where ?? 'General'}`);
  };

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      onExited={onExited}
      title="New task"
      dirty={dirty}
      onSubmit={create}
      footer={
        <>
          <span className="flex-1" />
          <SidePanelCancel />
          <Button type="submit" className="press">
            Add task
          </Button>
        </>
      }
    >
      <Field label="Title" required error={titleError}>
        <Input
          ref={titleRef}
          value={values.title}
          maxLength={LIMITS.titleMax}
          autoComplete="off"
          enterKeyHint="done"
          className="h-11 text-base desk:h-8 desk:text-xs"
          onChange={(e) => {
            set('title', e.target.value);
            if (titleError && e.target.value.trim()) setTitleError(null);
          }}
        />
      </Field>
      <Field label="Project">
        <ProjectPicker
          value={values.projectId}
          onChange={(id) => set('projectId', id)}
        />
      </Field>
      <PriorityPicker
        value={values.priority}
        onChange={(priority) => set('priority', priority)}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Due">
          <DatePicker
            id="new-task-due"
            value={values.due}
            onChange={(due) => set('due', due)}
            onInvalidChange={setDateInvalid}
          />
        </Field>
        <AssigneeField
          value={values.assignee}
          onChange={(assignee) => set('assignee', assignee)}
        />
      </div>
      <Field label="Details" hint="Markdown; type / for styles, @ to mention">
        <NoteComposer
          value={values.desc}
          onChange={(desc) => set('desc', desc)}
          people={people}
          maxLength={LIMITS.bodyMax}
        />
      </Field>
    </SidePanel>
  );
}

/**
 * The assignee: a person picker whose "Add a person…" opens a name field
 * below it; Enter adds the person (or picks the one that name means) and
 * assigns them, Escape goes back to the picker.
 */
function AssigneeField({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  // Back to the picker before the field goes, so focus never falls out of
  // the panel.
  const done = () => {
    wrap.current
      ?.querySelector<HTMLInputElement>('input[role="combobox"]')
      ?.focus();
    setAdding(false);
  };
  return (
    <div ref={wrap} className="flex flex-col gap-3">
      <Field label="Assignee">
        <PersonPicker
          value={value}
          onChange={onChange}
          allowCreate
          onAddPerson={() => setAdding(true)}
        />
      </Field>
      {adding && (
        <InlineAdd
          label="New assignee’s name"
          className="enter"
          onAdd={({ id }) => {
            onChange(id);
            done();
          }}
          onCancel={done}
        />
      )}
    </div>
  );
}

import {
  ArrowDownIcon,
  ArrowUpIcon,
  PlusIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { LIMITS } from '#shared/limits';
import {
  PRIORITIES,
  type Priority,
  type Template,
  type TemplateTask,
} from '#shared/types';
import { Field } from '@/components/Field';
import { TagInput } from '@/components/inputs/TagInput';
import { PRIORITY_LABELS } from '@/components/PriorityDot';
import { SidePanel, SidePanelCancel, useDirty } from '@/components/SidePanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDatapad } from '@/hooks/useDatapad';
import { useToast } from '@/providers/ToastProvider';

interface Values {
  name: string;
  defaultTags: string[];
  tasks: TemplateTask[];
}

const SELECT =
  'h-11 shrink-0 border border-input bg-background px-1.5 text-base outline-ring/50 focus-visible:outline-2 desk:h-8 desk:text-xs';

/**
 * A template: its name, the tags a project starts with, and its tasks in
 * order (title and priority; tags per task come from a saved project).
 * Rows are added, removed and moved with buttons; Enter in a title adds
 * the next one.
 */
export function TemplateForm({
  template,
  preset,
  open,
  onClose,
  onExited,
}: {
  template?: Template;
  /** A new template's starting values ("Save as template"). */
  preset?: Partial<Values>;
  open: boolean;
  onClose: () => void;
  onExited: () => void;
}) {
  const { state, actions } = useDatapad();
  const { show } = useToast();
  // Read once, when the panel opens.
  const [initial] = useState<Values>(() => ({
    name: template?.name ?? preset?.name ?? '',
    defaultTags: template?.defaultTags ?? preset?.defaultTags ?? [],
    tasks: template?.tasks ??
      preset?.tasks ?? [{ title: '', priority: 'none', tags: [] }],
  }));
  const [values, setValues] = useState(initial);
  const [nameError, setNameError] = useState<string | null>(null);
  const dirty = useDirty(values, initial);
  const tagSuggestions = [
    ...new Set(Object.values(state?.projects ?? {}).flatMap((p) => p.tags)),
  ];

  const setTask = (i: number, patch: Partial<TemplateTask>) =>
    setValues((v) => ({
      ...v,
      tasks: v.tasks.map((t, j) => (j === i ? { ...t, ...patch } : t)),
    }));
  const move = (i: number, to: number) =>
    setValues((v) => {
      const tasks = [...v.tasks];
      const [t] = tasks.splice(i, 1);
      if (t) tasks.splice(to, 0, t);
      return { ...v, tasks };
    });
  const addRow = (after: number) => {
    setValues((v) => {
      const tasks = [...v.tasks];
      tasks.splice(after + 1, 0, { title: '', priority: 'none', tags: [] });
      return { ...v, tasks };
    });
    requestAnimationFrame(() =>
      document.getElementById(`template-task-${after + 1}`)?.focus(),
    );
  };

  const save = () => {
    const name = values.name.trim();
    if (!name) {
      setNameError('Give the template a name');
      document.getElementById('template-name')?.focus();
      return;
    }
    const tasks = values.tasks
      .map((t) => ({ ...t, title: t.title.trim() }))
      .filter((t) => t.title);
    const fields = { name, tasks, defaultTags: values.defaultTags };
    const ok = template
      ? actions.editTemplate({ id: template.id, patch: fields })
      : actions.addTemplate(fields) !== null;
    if (!ok) return;
    onClose();
    show(`${template ? 'Saved' : 'Added'} template “${name}”`);
  };

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      onExited={onExited}
      title={template ? 'Template' : 'New template'}
      description="A project's starting tasks and tags"
      dirty={dirty}
      onSubmit={save}
      footer={
        <>
          {template && (
            <Button
              type="button"
              variant="ghost"
              className="press text-destructive"
              onClick={() => {
                const gone = template;
                if (!actions.deleteTemplate({ id: gone.id })) return;
                onClose();
                show(`Deleted template “${gone.name}”`, () =>
                  actions.put({ col: 'templates', doc: gone }),
                );
              }}
            >
              Delete
            </Button>
          )}
          <span className="flex-1" />
          <SidePanelCancel />
          <Button type="submit" className="press">
            {template ? 'Save' : 'Add template'}
          </Button>
        </>
      }
    >
      <Field label="Name" required error={nameError}>
        <Input
          id="template-name"
          value={values.name}
          autoComplete="off"
          onChange={(e) => {
            setValues((v) => ({ ...v, name: e.target.value }));
            if (nameError && e.target.value.trim()) setNameError(null);
          }}
          className="h-11 text-base desk:h-8 desk:text-xs"
        />
      </Field>
      <Field label="Project tags">
        <TagInput
          value={values.defaultTags}
          onChange={(defaultTags) => setValues((v) => ({ ...v, defaultTags }))}
          suggestions={tagSuggestions}
        />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-xs font-medium">Tasks, in order</legend>
        <ol className="flex flex-col gap-1.5">
          {values.tasks.map((t, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are positions.
              key={i}
              className="flex flex-wrap items-center gap-1 border-b pb-1.5 sm:flex-nowrap sm:border-0 sm:pb-0"
            >
              <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                {i + 1}
              </span>
              <Input
                id={`template-task-${i}`}
                aria-label={`Task ${i + 1}`}
                value={t.title}
                maxLength={LIMITS.titleMax}
                autoComplete="off"
                onChange={(e) => setTask(i, { title: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                    e.preventDefault();
                    if (values.tasks.length < LIMITS.templateTasksMax)
                      addRow(i);
                  }
                }}
                className="h-11 min-w-0 flex-1 basis-[calc(100%-1.5rem)] text-base sm:basis-auto desk:h-8 desk:text-xs"
              />
              <select
                aria-label={`Priority of task ${i + 1}`}
                value={t.priority}
                onChange={(e) =>
                  setTask(i, { priority: e.target.value as Priority })
                }
                className={`${SELECT} ml-6 sm:ml-0`}
              >
                {[...PRIORITIES].reverse().map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="press size-11 desk:size-8"
                disabled={i === 0}
                onClick={() => move(i, i - 1)}
              >
                <ArrowUpIcon />
                <span className="sr-only">Move task {i + 1} up</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="press size-11 desk:size-8"
                disabled={i === values.tasks.length - 1}
                onClick={() => move(i, i + 1)}
              >
                <ArrowDownIcon />
                <span className="sr-only">Move task {i + 1} down</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="press size-11 desk:size-8"
                onClick={() =>
                  setValues((v) => ({
                    ...v,
                    tasks: v.tasks.filter((_, j) => j !== i),
                  }))
                }
              >
                <XIcon />
                <span className="sr-only">Remove task {i + 1}</span>
              </Button>
            </li>
          ))}
        </ol>
        <Button
          type="button"
          variant="outline"
          className="press self-start"
          disabled={values.tasks.length >= LIMITS.templateTasksMax}
          onClick={() => addRow(values.tasks.length - 1)}
        >
          <PlusIcon />
          Add a task
        </Button>
      </fieldset>
    </SidePanel>
  );
}

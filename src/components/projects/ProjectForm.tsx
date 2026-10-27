import { useMemo, useRef, useState } from 'react';
import { LIMITS } from '#shared/limits';
import { orgByName } from '#shared/orgs';
import { templatesOf } from '#shared/templates';
import {
  healthOf,
  type Link,
  type Priority,
  type Project,
  type ProjectHealth,
  type ProjectStatus,
  settingsOf,
} from '#shared/types';
import { Field } from '@/components/Field';
import { DatePicker } from '@/components/inputs/DatePicker';
import { cleanLinks, LinksEditor } from '@/components/inputs/LinksEditor';
import { MemberChips } from '@/components/inputs/MemberChips';
import { PriorityPicker } from '@/components/inputs/PriorityPicker';
import { Segmented } from '@/components/inputs/Segmented';
import { SelectField } from '@/components/inputs/SelectField';
import { TagInput } from '@/components/inputs/TagInput';
import { NoteComposer } from '@/components/NoteComposer';
import { OrgPicker } from '@/components/pickers/OrgPicker';
import { HealthPicker } from '@/components/projects/Health';
import { SidePanel, SidePanelCancel, useDirty } from '@/components/SidePanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDatapad } from '@/hooks/useDatapad';
import { newId } from '@/lib/ids';
import { navigate } from '@/lib/router';
import { useToast } from '@/providers/ToastProvider';

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  done: 'Done',
};

interface Values {
  name: string;
  org: string;
  status: ProjectStatus;
  health: ProjectHealth;
  priority: Priority;
  startDate: string;
  targetDate: string;
  tags: string[];
  members: string[];
  desc: string;
  links: Link[];
}

function valuesOf(project: Project | undefined, defaultOrg = ''): Values {
  return {
    name: project?.name ?? '',
    org: project?.org ?? defaultOrg,
    status: project?.status ?? 'active',
    health: project ? healthOf(project) : 'none',
    priority: project?.priority ?? 'none',
    startDate: project?.startDate ?? '',
    targetDate: project?.targetDate ?? '',
    tags: project?.tags ?? [],
    members: project?.members ?? [],
    desc: project?.desc ?? '',
    links: project?.links ?? [],
  };
}

/** "Delete Apollo and its 12 tasks, 8 notes and activity?" */
export function deleteQuestion(
  name: string,
  tasks: number,
  notes: number,
  milestones = 0,
) {
  const parts = [
    tasks === 1 ? '1 task' : `${tasks} tasks`,
    notes === 1 ? '1 note' : `${notes} notes`,
  ];
  // Milestones live on the project and go with it; named only when there are some.
  if (milestones > 0) {
    parts.push(milestones === 1 ? '1 milestone' : `${milestones} milestones`);
  }
  return `Delete ${name} and its ${parts.join(', ')} and activity?`;
}

/**
 * Create or edit a project in the side panel. Name, then Enter, is a whole
 * project; everything else is optional. The values are read once when the
 * panel opens, so a sync underneath never clobbers what you are typing.
 * Save is never disabled: it moves focus to the first problem instead.
 */
export function ProjectForm({
  project,
  open,
  onClose,
  onExited,
}: {
  /** Absent: a new project. */
  project?: Project;
  open: boolean;
  onClose: () => void;
  onExited: () => void;
}) {
  const { state, actions } = useDatapad();
  const { show } = useToast();
  // A new project starts in your default org (Settings → Orgs).
  const [initial] = useState(() =>
    valuesOf(project, state ? settingsOf(state).defaultOrg : ''),
  );
  const [values, setValues] = useState(initial);
  const [templateId, setTemplateId] = useState('');
  const templateOptions = useMemo(
    () => [
      { value: '', label: 'No template' },
      ...templatesOf(state?.templates ?? {}, 'project').map((t) => ({
        value: t.id,
        label: `${t.name} (${t.tasks.length === 1 ? '1 task' : `${t.tasks.length} tasks`})`,
      })),
    ],
    [state?.templates],
  );
  const [nameError, setNameError] = useState<string | null>(null);
  const [startInvalid, setStartInvalid] = useState(false);
  const [dateInvalid, setDateInvalid] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const dirty = useDirty(values, initial);

  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const people = useMemo(
    () =>
      Object.values(state?.people ?? {}).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [state?.people],
  );
  const tagSuggestions = useMemo(
    () => [
      ...new Set(Object.values(state?.projects ?? {}).flatMap((p) => p.tags)),
    ],
    [state?.projects],
  );
  const counts = useMemo(() => {
    if (!project || !state) return { tasks: 0, notes: 0, milestones: 0 };
    return {
      milestones: project.milestones?.length ?? 0,
      tasks: Object.values(state.tasks).filter(
        (t) => t.projectId === project.id,
      ).length,
      notes: Object.values(state.notes).filter(
        (n) => n.projectId === project.id,
      ).length,
    };
  }, [project, state]);

  const orgIdFor = (name: string): string | null =>
    (state && orgByName(state.orgs, name)?.id) || null;

  const save = () => {
    const name = values.name.trim();
    if (!name) {
      setNameError('Give the project a name');
      nameRef.current?.focus();
      return;
    }
    if (startInvalid) {
      document.getElementById('project-start')?.focus();
      return;
    }
    if (dateInvalid) {
      document.getElementById('project-target')?.focus();
      return;
    }
    if (
      values.startDate &&
      values.targetDate &&
      values.startDate > values.targetDate
    ) {
      setDateError('Starts after the target date');
      document.getElementById('project-target')?.focus();
      return;
    }
    const fields = {
      name,
      org: values.org.trim(),
      priority: values.priority,
      startDate: values.startDate,
      targetDate: values.targetDate,
      tags: values.tags,
      members: values.members,
      desc: values.desc,
      links: cleanLinks(values.links),
    };
    if (!project) {
      const template = templateId ? state?.templates[templateId] : undefined;
      const id = actions.createProject({
        ...fields,
        status: values.status,
        health: values.health,
        orgId: orgIdFor(values.org) ?? undefined,
        ...(template
          ? {
              template: {
                id: template.id,
                taskIds: template.tasks.map(() => newId()),
              },
            }
          : {}),
      });
      if (!id) return;
      onClose();
      show(`Created ${name}`);
      navigate({ name: 'project', id });
      return;
    }
    const before = valuesOf(project);
    const patch: Record<string, unknown> = Object.fromEntries(
      Object.entries(fields).filter(
        ([key, value]) =>
          JSON.stringify(value) !==
          JSON.stringify(
            key === 'links' ? before.links : before[key as keyof typeof fields],
          ),
      ),
    );
    // The org's record, by name; null when there is none (text only).
    const orgId = orgIdFor(values.org);
    if (orgId !== (project.orgId ?? null)) patch.orgId = orgId;
    if (Object.keys(patch).length > 0) {
      if (!actions.editProject({ id: project.id, patch })) return;
    }
    if (values.status !== project.status) {
      actions.setStatus({ id: project.id, status: values.status });
    }
    if (values.health !== healthOf(project)) {
      actions.setHealth({ id: project.id, health: values.health });
    }
    onClose();
    if (dirty) show(`Saved ${name}`);
  };

  const remove = () => {
    if (!project) return;
    if (!actions.deleteProject({ id: project.id })) return;
    onClose();
    show(`Deleted ${project.name}`);
    navigate({ name: 'projects' });
  };

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      onExited={onExited}
      title={project ? `Edit ${project.name}` : 'New project'}
      dirty={dirty}
      onSubmit={save}
      footer={
        confirmingDelete && project ? (
          <div
            role="alertdialog"
            aria-labelledby="delete-question"
            className="flex w-full flex-wrap items-center gap-2"
          >
            <p id="delete-question" className="flex-1 text-sm">
              {deleteQuestion(
                project.name,
                counts.tasks,
                counts.notes,
                counts.milestones,
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              className="press"
              autoFocus
              onClick={() => setConfirmingDelete(false)}
            >
              Keep it
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="press"
              onClick={remove}
            >
              Delete project
            </Button>
          </div>
        ) : (
          <>
            {project && (
              <Button
                type="button"
                variant="ghost"
                className="press text-destructive"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete
              </Button>
            )}
            <span className="flex-1" />
            <SidePanelCancel />
            <Button type="submit" className="press">
              {project ? 'Save' : 'Create project'}
            </Button>
          </>
        )
      }
    >
      <Field label="Name" required error={nameError}>
        <Input
          ref={nameRef}
          value={values.name}
          maxLength={LIMITS.nameMax}
          autoComplete="off"
          enterKeyHint="done"
          className="h-11 text-base desk:h-8 desk:text-xs"
          onChange={(e) => {
            set('name', e.target.value);
            if (nameError && e.target.value.trim()) setNameError(null);
          }}
        />
      </Field>
      {!project && templateOptions.length > 1 && (
        <SelectField
          label="Start from template"
          value={templateId}
          options={templateOptions}
          onChange={setTemplateId}
        />
      )}
      <Field label="Org">
        <OrgPicker value={values.org} onChange={(org) => set('org', org)} />
      </Field>
      <Segmented
        legend="Status"
        value={values.status}
        onChange={(status) => set('status', status)}
        options={(['active', 'paused', 'done'] as const).map((s) => ({
          value: s,
          label: STATUS_LABELS[s],
        }))}
      />
      <HealthPicker
        value={values.health}
        onChange={(health) => set('health', health)}
      />
      <PriorityPicker
        value={values.priority}
        onChange={(priority) => set('priority', priority)}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Start date">
          <DatePicker
            id="project-start"
            value={values.startDate}
            onChange={(date) => {
              set('startDate', date);
              setDateError(null);
            }}
            onInvalidChange={setStartInvalid}
          />
        </Field>
        <Field label="Target date" error={dateError}>
          <DatePicker
            id="project-target"
            value={values.targetDate}
            onChange={(date) => {
              set('targetDate', date);
              setDateError(null);
            }}
            onInvalidChange={setDateInvalid}
          />
        </Field>
      </div>
      <Field label="Tags">
        <TagInput
          value={values.tags}
          onChange={(tags) => set('tags', tags)}
          suggestions={tagSuggestions}
        />
      </Field>
      <MemberChips
        people={people}
        value={values.members}
        onChange={(members) => set('members', members)}
      />
      <Field label="Description" hint="Markdown; type / for styles">
        <NoteComposer
          value={values.desc}
          onChange={(desc) => set('desc', desc)}
          people={{}}
          rows={5}
        />
      </Field>
      <LinksEditor
        value={values.links}
        onChange={(links) => set('links', links)}
      />
    </SidePanel>
  );
}

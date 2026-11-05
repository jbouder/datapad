import { useCallback, useState } from 'react';
import { LIMITS } from '#shared/limits';
import type { List } from '#shared/types';
import { Field } from '@/components/Field';
import { ProjectPicker } from '@/components/pickers/ProjectPicker';
import { SidePanel, SidePanelCancel, useDirty } from '@/components/SidePanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDatapad } from '@/hooks/useDatapad';
import { navigate } from '@/lib/router';

/** What the panel opens for: a new list (preset project) or one to edit. */
export type ListPanelFor =
  | { kind: 'new'; projectId: string | null }
  | { kind: 'edit'; list: List };

/**
 * A list's title and project (#299), in the side panel: New list adds it
 * and lands on its page; Edit saves both. Closing with changes asks
 * first.
 */
export function ListPanel({
  of,
  open,
  onClose,
  onExited,
}: {
  of: ListPanelFor;
  open: boolean;
  onClose: () => void;
  onExited: () => void;
}) {
  const { actions } = useDatapad();
  const initial = {
    title: of.kind === 'edit' ? of.list.title : '',
    projectId: of.kind === 'edit' ? of.list.projectId : of.projectId,
  };
  const [title, setTitle] = useState(initial.title);
  const [projectId, setProjectId] = useState(initial.projectId);
  const [error, setError] = useState<string | null>(null);
  const dirty = useDirty({ title, projectId }, initial);

  const save = () => {
    const text = title.trim();
    if (!text) {
      setError('Give the list a title');
      document.getElementById('list-panel-title')?.focus();
      return;
    }
    if (of.kind === 'edit') {
      if (actions.editList({ id: of.list.id, title: text, projectId })) {
        onClose();
      }
      return;
    }
    const id = actions.addList({ title: text, projectId });
    if (id === null) return;
    onClose();
    navigate({ name: 'list', id });
  };

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      onExited={onExited}
      title={of.kind === 'edit' ? 'Edit list' : 'New list'}
      dirty={dirty}
      onSubmit={save}
      footer={
        <>
          <span className="flex-1" />
          <SidePanelCancel />
          <Button type="submit" className="press">
            {of.kind === 'edit' ? 'Save' : 'Add list'}
          </Button>
        </>
      }
    >
      <Field label="Title" error={error} required>
        <Input
          id="list-panel-title"
          value={title}
          maxLength={LIMITS.titleMax}
          autoComplete="off"
          placeholder="Packing for the offsite"
          className="h-11 text-base desk:h-8 desk:text-sm"
          onChange={(e) => {
            setTitle(e.target.value);
            if (error && e.target.value.trim()) setError(null);
          }}
        />
      </Field>
      <Field label="Project">
        <ProjectPicker value={projectId} onChange={setProjectId} />
      </Field>
    </SidePanel>
  );
}

/**
 * The list panel's state for a page: `openPanel` opens it for a new list
 * or one to edit, and `panel` is the element to render (null when shut).
 * Each opening is a fresh form.
 */
export function useListPanel(): {
  openPanel: (of: ListPanelFor) => void;
  panel: React.ReactNode;
} {
  const [session, setSession] = useState<{
    key: number;
    of: ListPanelFor;
    open: boolean;
  } | null>(null);
  const openPanel = useCallback(
    (of: ListPanelFor) =>
      setSession((s) => ({ key: (s?.key ?? 0) + 1, of, open: true })),
    [],
  );
  const panel = session && (
    <ListPanel
      key={session.key}
      of={session.of}
      open={session.open}
      onClose={() => setSession((s) => (s ? { ...s, open: false } : s))}
      onExited={() => setSession((s) => (s?.open ? s : null))}
    />
  );
  return { openPanel, panel };
}

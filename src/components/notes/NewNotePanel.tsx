import { useRef, useState } from 'react';
import { namesToTokens } from '#shared/mentions';
import { Field } from '@/components/Field';
import { NoteComposer } from '@/components/NoteComposer';
import { useNoteCommands } from '@/components/notes/NoteForm';
import { ProjectPicker } from '@/components/pickers/ProjectPicker';
import { SidePanel, SidePanelCancel } from '@/components/SidePanel';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { newId } from '@/lib/ids';
import { useToast } from '@/providers/ToastProvider';

/**
 * A note from anywhere: the composer and its project (the one you are on,
 * or General). The top bar's note button opens it, and `N`. Closing with
 * something written asks first.
 */
export function NewNotePanel({
  projectId,
  open,
  onClose,
  onExited,
}: {
  projectId: string | null;
  open: boolean;
  onClose: () => void;
  onExited: () => void;
}) {
  const { state, actions } = useDatapad();
  const { show } = useToast();
  const people = state?.people ?? {};
  const [project, setProject] = useState(projectId);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** The id the note will have, known before it is added. */
  const noteId = useRef(newId());
  const commands = useNoteCommands(project);

  const add = () => {
    const body = namesToTokens(text, people).trim();
    if (!body) {
      setError('Write something first');
      document.getElementById('new-note-body')?.focus();
      return;
    }
    if (
      actions.addNote({ id: noteId.current, projectId: project, body }) === null
    ) {
      return;
    }
    onClose();
    const where = project ? state?.projects[project]?.name : undefined;
    show(`Added a note to ${where ?? 'General'}`);
  };

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      onExited={onExited}
      title="New note"
      dirty={text.trim() !== ''}
      onSubmit={add}
      footer={
        <>
          <span className="flex-1" />
          <SidePanelCancel />
          <Button type="submit" className="press">
            Add note
          </Button>
        </>
      }
    >
      <Field
        label="Note"
        hint="Markdown; type / for styles, @ to mention"
        error={error}
      >
        <NoteComposer
          id="new-note-body"
          value={text}
          onChange={(value) => {
            setText(value);
            if (error && value.trim()) setError(null);
          }}
          people={people}
          className="min-h-40"
          {...commands}
        />
      </Field>
      <Field label="Project">
        <ProjectPicker value={project} onChange={setProject} />
      </Field>
    </SidePanel>
  );
}

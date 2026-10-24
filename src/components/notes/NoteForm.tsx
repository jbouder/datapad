import { PlusIcon } from '@phosphor-icons/react';
import { useId, useState } from 'react';
import { namesToTokens } from '#shared/mentions';
import type { Person } from '#shared/types';
import { Field } from '@/components/Field';
import { NoteComposer } from '@/components/NoteComposer';
import { ProjectPicker } from '@/components/pickers/ProjectPicker';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { useToast } from '@/providers/ToastProvider';

/**
 * Write a note: the composer, the project it goes to (a picker on the
 * Notes page, fixed on a project page) and Add note (or ⌘Enter). The
 * draft is kept per project; adding clears it and keeps the focus for
 * the next one. `/task` makes a task in the same project.
 */
export function NoteForm({
  projectId: fixed,
  people,
}: {
  /** A project page's project; omitted, a picker chooses (General first). */
  projectId?: string | null;
  people: Record<string, Person>;
}) {
  const { actions } = useDatapad();
  const { show } = useToast();
  const [picked, setPicked] = useState<string | null>(null);
  const projectId = fixed === undefined ? picked : fixed;
  const [text, setText] = useState('');
  const id = useId();

  const add = () => {
    const body = namesToTokens(text, people).trim();
    if (!body) return;
    if (actions.addNote({ projectId, body }) === null) return;
    setText('');
    document.getElementById(id)?.focus();
  };

  return (
    <div className="flex flex-col gap-2">
      <Field label="New note" labelHidden>
        <NoteComposer
          id={id}
          value={text}
          onChange={setText}
          people={people}
          placeholder="Write a note. / for styles, @ to mention"
          draftKey={`datapad:draft:note:${fixed === undefined ? 'notes' : (fixed ?? 'general')}`}
          onSubmit={add}
          onTask={(title) => {
            if (actions.addTask({ projectId, title }) === null) return false;
            show(`Added “${title}”`);
            return true;
          }}
        />
      </Field>
      <div className="flex flex-wrap items-end gap-2">
        {fixed === undefined && (
          <div className="min-w-48 flex-1 desk:max-w-64">
            <ProjectPicker
              value={picked}
              onChange={setPicked}
              aria-label="Project for the note"
            />
          </div>
        )}
        <Button
          className="press ml-auto h-11 desk:h-8"
          disabled={!text.trim()}
          onClick={add}
        >
          <PlusIcon />
          Add note
        </Button>
      </div>
    </div>
  );
}

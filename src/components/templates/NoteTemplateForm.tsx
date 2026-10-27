import { useState } from 'react';
import { namesToTokens, tokensToNames } from '#shared/mentions';
import type { Template } from '#shared/types';
import { Field } from '@/components/Field';
import { NoteComposer } from '@/components/NoteComposer';
import { SidePanel, SidePanelCancel, useDirty } from '@/components/SidePanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDatapad } from '@/hooks/useDatapad';
import { useToast } from '@/providers/ToastProvider';

interface Values {
  name: string;
  body: string;
}

/**
 * A note template: its name and the Markdown a note starts from. `/template`
 * in a note composer and the New note panel's picker put it in.
 */
export function NoteTemplateForm({
  template,
  preset,
  open,
  onClose,
  onExited,
}: {
  template?: Template;
  /** A new template's starting values (a note's Save as template). */
  preset?: Partial<Values>;
  open: boolean;
  onClose: () => void;
  onExited: () => void;
}) {
  const { state, actions } = useDatapad();
  const { show } = useToast();
  const people = state?.people ?? {};
  // Read once, when the panel opens.
  const [initial] = useState<Values>(() => ({
    name: template?.name ?? preset?.name ?? '',
    body: tokensToNames(template?.body ?? preset?.body ?? '', people),
  }));
  const [values, setValues] = useState(initial);
  const [nameError, setNameError] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const dirty = useDirty(values, initial);

  const save = () => {
    const name = values.name.trim();
    const body = namesToTokens(values.body, people).trim();
    if (!name) setNameError('Give the template a name');
    if (!body) setBodyError('Write what a note starts with');
    if (!name || !body) {
      document
        .getElementById(name ? 'note-template-body' : 'template-name')
        ?.focus();
      return;
    }
    const ok = template
      ? actions.editTemplate({ id: template.id, patch: { name, body } })
      : actions.addTemplate({ name, body }) !== null;
    if (!ok) return;
    onClose();
    show(`${template ? 'Saved' : 'Added'} template “${name}”`);
  };

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      onExited={onExited}
      title={template ? 'Note template' : 'New note template'}
      description="What a new note starts with"
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
      <Field
        label="Note"
        hint="Markdown; type / for styles, @ to mention"
        required
        error={bodyError}
      >
        <NoteComposer
          id="note-template-body"
          value={values.body}
          onChange={(body) => {
            setValues((v) => ({ ...v, body }));
            if (bodyError && body.trim()) setBodyError(null);
          }}
          people={people}
          className="min-h-48"
        />
      </Field>
    </SidePanel>
  );
}

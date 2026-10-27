import { PlusIcon } from '@phosphor-icons/react';
import { useId, useMemo } from 'react';
import { templatesOf } from '#shared/templates';
import type { Template } from '#shared/types';
import { useTemplateForm } from '@/components/templates/TemplateFormProvider';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';

/**
 * Settings → Templates: the kickoff checklists a new project can start
 * from, and the notes a new note can. "Save as template" in a project's
 * header or on a note makes one.
 */
export function TemplatesSettings() {
  const { state } = useDatapad();
  const { openTemplate, newTemplate, newNoteTemplate } = useTemplateForm();
  const projects = useMemo(
    () => templatesOf(state?.templates ?? {}, 'project'),
    [state?.templates],
  );
  const notes = useMemo(
    () => templatesOf(state?.templates ?? {}, 'note'),
    [state?.templates],
  );
  return (
    <>
      <TemplateGroup
        title="Project templates"
        intro="Every engagement starts with the same few tasks. Pick a template in a new project’s form and they are there, in order, with its tags."
        add="New project template"
        onAdd={() => newTemplate()}
        empty="No project templates yet. Make one here, or from a project with Save as template."
        templates={projects}
        onOpen={openTemplate}
        detail={(t) =>
          t.tasks.length === 1 ? '1 task' : `${t.tasks.length} tasks`
        }
      />
      <TemplateGroup
        title="Note templates"
        intro="The notes you write the same way every time: a 1:1, a retro, a status update. Type /template in a note, or pick one in the New note panel."
        add="New note template"
        onAdd={() => newNoteTemplate()}
        empty="No note templates yet. Make one here, or from a note with Save as template."
        templates={notes}
        onOpen={openTemplate}
      />
    </>
  );
}

function TemplateGroup({
  title,
  intro,
  add,
  onAdd,
  empty,
  templates,
  onOpen,
  detail,
}: {
  title: string;
  intro: string;
  add: string;
  onAdd: () => void;
  empty: string;
  templates: Template[];
  onOpen: (id: string) => void;
  detail?: (t: Template) => string;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="text-sm font-semibold">
        {title}
      </h3>
      <p className="text-sm text-muted-foreground">{intro}</p>
      <Button variant="outline" className="press self-start" onClick={onAdd}>
        <PlusIcon />
        {add}
      </Button>
      {templates.length === 0 ? (
        <p className="text-state">{empty}</p>
      ) : (
        <ul aria-label={title} className="flex flex-col border-t">
          {templates.map((t) => (
            <li
              key={t.id}
              className="row flex items-center gap-3 border-b text-sm"
            >
              <button
                type="button"
                onClick={() => onOpen(t.id)}
                className="min-w-0 flex-1 truncate text-left font-medium outline-ring/50 hover:underline focus-visible:outline-2"
              >
                {t.name}
              </button>
              {detail && (
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {detail(t)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

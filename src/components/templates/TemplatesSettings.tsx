import { PlusIcon } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { useTemplateForm } from '@/components/templates/TemplateFormProvider';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';

/**
 * Settings → Templates: the kickoff checklists a new project can start
 * from. "Save as template" in a project's header makes one from its
 * open tasks.
 */
export function TemplatesSettings() {
  const { state } = useDatapad();
  const { openTemplate, newTemplate } = useTemplateForm();
  const templates = useMemo(
    () =>
      Object.values(state?.templates ?? {}).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [state?.templates],
  );
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Every engagement starts with the same few tasks. Pick a template in a
        new project’s form and they are there, in order, with its tags.
      </p>
      <Button
        variant="outline"
        className="press self-start"
        onClick={() => newTemplate()}
      >
        <PlusIcon />
        New template
      </Button>
      {templates.length === 0 ? (
        <p className="text-state">
          No templates yet. Make one here, or from a project’s Tasks with Save
          as template.
        </p>
      ) : (
        <ul aria-label="Templates" className="flex flex-col border-t">
          {templates.map((t) => (
            <li
              key={t.id}
              className="row flex items-center gap-3 border-b text-sm"
            >
              <button
                type="button"
                onClick={() => openTemplate(t.id)}
                className="min-w-0 flex-1 truncate text-left font-medium outline-ring/50 hover:underline focus-visible:outline-2"
              >
                {t.name}
              </button>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {t.tasks.length === 1 ? '1 task' : `${t.tasks.length} tasks`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

import { useMemo } from 'react';
import type { TemplateChoice } from '#shared/composer';
import { tokensToNames } from '#shared/mentions';
import { defaultAssignee } from '#shared/tasks';
import { templatesOf } from '#shared/templates';
import { useDatapad } from '@/hooks/useDatapad';
import { useToast } from '@/providers/ToastProvider';

/** The space's note templates for a composer, mentions as names. */
export function useNoteTemplates(): TemplateChoice[] {
  const { state } = useDatapad();
  const templates = state?.templates;
  const people = state?.people;
  return useMemo(
    () =>
      templatesOf(templates ?? {}, 'note').map((t) => ({
        id: t.id,
        name: t.name,
        body: tokensToNames(t.body, people ?? {}),
      })),
    [templates, people],
  );
}

/**
 * A note composer's extras: `/task`, a task in the note's project, and
 * the note templates `/template` inserts.
 */
export function useNoteCommands(projectId: string | null): {
  onTask: (title: string) => boolean;
  templates: TemplateChoice[];
} {
  const { state, actions } = useDatapad();
  const { show } = useToast();
  const templates = useNoteTemplates();
  return {
    onTask: (title) => {
      const assignee = state ? defaultAssignee(state) : '';
      if (actions.addTask({ projectId, title, assignee }) === null) {
        return false;
      }
      show(`Added “${title}”`);
      return true;
    },
    templates,
  };
}

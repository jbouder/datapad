import { useMemo } from 'react';
import {
  type CaptureContext,
  canSave,
  captureOps,
  captureProblem,
  captureToast,
  parseCapture,
  undoCaptureOp,
} from '#shared/capture';
import {
  CREATE_COMMANDS,
  type CreateCommandId,
  captureKindOf,
  type TemplateChoice,
} from '#shared/composer';
import { namesToTokens, tokensToNames } from '#shared/mentions';
import { templatesOf } from '#shared/templates';
import { useDatapad } from '@/hooks/useDatapad';
import { useToday } from '@/hooks/useNow';
import { newId } from '@/lib/ids';
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
 * A note composer's extras: the create commands (#375), each made from
 * the line the way the capture line would read it, in the note's project
 * (tasks are action items, with `meetingId`, on a meeting's note, #336),
 * and the note templates `/template` inserts. `/milestone` needs a
 * project.
 */
export function useNoteCommands(
  projectId: string | null,
  meetingId?: string | null,
  noteId?: string | null,
): {
  onCreate: (id: CreateCommandId, line: string) => boolean;
  creates: readonly CreateCommandId[];
  templates: TemplateChoice[];
} {
  const create = useCreateFromLine({ projectId, meetingId, noteId });
  const templates = useNoteTemplates();
  const creates = useMemo(
    () => CREATE_COMMANDS.filter((c) => c !== 'milestone' || projectId),
    [projectId],
  );
  return { onCreate: create, creates, templates };
}

/**
 * Make what a create command names from a line of a note, through the
 * capture line's parser and ops, with a toast that offers Undo. False
 * (and a toast saying why) when the line cannot make one.
 */
export function useCreateFromLine(context: CaptureContext) {
  const { state, actions } = useDatapad();
  const { show } = useToast();
  const today = useToday();
  return (id: CreateCommandId, line: string): boolean => {
    if (!state) return false;
    const capture = parseCapture(
      namesToTokens(line, state.people),
      state,
      today,
      { ...context, fromNote: true },
      captureKindOf(id),
    );
    if (!canSave(capture, state)) {
      const problem = captureProblem(capture, state);
      if (problem) show(problem);
      return false;
    }
    const docId = newId();
    if (!actions.batch({ ops: captureOps(capture, state, docId) })) {
      return false;
    }
    const undo = undoCaptureOp(capture.kind, docId, capture.projectId);
    show(captureToast(capture, state), () => {
      actions.batch({ ops: [undo] });
    });
    return true;
  };
}

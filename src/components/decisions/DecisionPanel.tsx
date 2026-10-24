import { useMemo, useRef, useState } from 'react';
import { localDate } from '#shared/dates';
import { namesToTokens, tokensToNames } from '#shared/mentions';
import {
  DECISION_STATUSES,
  type Decision,
  type DecisionStatus,
  type Link,
} from '#shared/types';
import { DECISION_LABELS } from '@/components/decisions/DecisionStatus';
import { Field } from '@/components/Field';
import { DatePicker } from '@/components/inputs/DatePicker';
import { cleanLinks, LinksEditor } from '@/components/inputs/LinksEditor';
import { MemberChips } from '@/components/inputs/MemberChips';
import { Segmented } from '@/components/inputs/Segmented';
import { NoteComposer } from '@/components/NoteComposer';
import { ProjectPicker } from '@/components/pickers/ProjectPicker';
import { SidePanel, SidePanelCancel, useDirty } from '@/components/SidePanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDatapad } from '@/hooks/useDatapad';
import { linkProps } from '@/lib/router';
import { useToast } from '@/providers/ToastProvider';

interface Values {
  title: string;
  projectId: string | null;
  status: DecisionStatus;
  decidedAt: string;
  deciders: string[];
  rationale: string;
  links: Link[];
}

/**
 * One decision's editor, new or existing: title, project, status, when,
 * who, why (Markdown with mentions) and links. Read once on open, like the
 * task panel. Save sends `editDecision` for the fields and
 * `setDecisionStatus` for the status, so the log says "Decided …".
 */
export function DecisionPanel({
  decision,
  preset,
  open,
  onClose,
  onExited,
}: {
  /** Absent: a new decision. */
  decision?: Decision;
  /** A new one's project and title. */
  preset?: { projectId: string | null; title?: string };
  open: boolean;
  onClose: () => void;
  onExited: () => void;
}) {
  const { state, actions } = useDatapad();
  const { show } = useToast();
  const people = state?.people ?? {};
  const initial = useMemo<Values>(
    () => ({
      title: decision?.title ?? preset?.title ?? '',
      projectId: decision ? decision.projectId : (preset?.projectId ?? null),
      status: decision?.status ?? 'proposed',
      decidedAt: decision?.decidedAt ?? '',
      deciders: decision?.deciders ?? [],
      rationale: decision ? tokensToNames(decision.rationale, people) : '',
      links: decision?.links ?? [],
    }),
    // Read once when the panel opens.
    // biome-ignore lint/correctness/useExhaustiveDependencies: on purpose.
    [],
  );
  const [values, setValues] = useState(initial);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [dateInvalid, setDateInvalid] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const dirty = useDirty(values, initial);
  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((v) => ({ ...v, [key]: value }));
  const everyone = useMemo(
    () => Object.values(people).sort((a, b) => a.name.localeCompare(b.name)),
    [people],
  );
  const source = decision?.sourceNoteId
    ? state?.notes[decision.sourceNoteId]
    : undefined;

  const save = () => {
    const title = values.title.trim();
    if (!title) {
      setTitleError('Give the decision a title');
      titleRef.current?.focus();
      return;
    }
    if (dateInvalid) {
      document.getElementById('decision-date')?.focus();
      return;
    }
    const fields = {
      title,
      projectId: values.projectId,
      decidedAt:
        values.status === 'decided' && !values.decidedAt
          ? localDate(new Date())
          : values.decidedAt,
      deciders: values.deciders,
      rationale: namesToTokens(values.rationale, people),
      links: cleanLinks(values.links),
    };
    if (!decision) {
      const id = actions.addDecision({ ...fields, status: values.status });
      if (!id) return;
      onClose();
      show(`${DECISION_LABELS[values.status]} “${title}”`);
      return;
    }
    const patch = Object.fromEntries(
      Object.entries(fields).filter(
        ([key, value]) =>
          JSON.stringify(value) !==
          JSON.stringify(decision[key as keyof typeof fields]),
      ),
    );
    if (Object.keys(patch).length > 0) {
      if (!actions.editDecision({ id: decision.id, patch })) return;
    }
    if (values.status !== decision.status) {
      actions.setDecisionStatus({
        id: decision.id,
        status: values.status,
        day: localDate(new Date()),
      });
    }
    onClose();
    if (dirty) show(`Saved “${title}”`);
  };

  const remove = () => {
    if (!decision) return;
    const gone = decision;
    if (!actions.deleteDecision({ id: gone.id })) return;
    onClose();
    show(`Deleted “${gone.title}”`, () => {
      actions.put({ col: 'decisions', doc: gone });
    });
  };

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      onExited={onExited}
      title={decision ? 'Decision' : 'New decision'}
      description={decision?.title ?? 'Record a decision'}
      dirty={dirty}
      onSubmit={save}
      footer={
        <>
          {decision && (
            <Button
              type="button"
              variant="ghost"
              className="press text-destructive"
              onClick={remove}
            >
              Delete
            </Button>
          )}
          <span className="flex-1" />
          <SidePanelCancel />
          <Button type="submit" className="press">
            {decision ? 'Save' : 'Add decision'}
          </Button>
        </>
      }
    >
      <Field label="Decision" required error={titleError}>
        <Input
          ref={titleRef}
          value={values.title}
          autoComplete="off"
          onChange={(e) => {
            set('title', e.target.value);
            if (titleError && e.target.value.trim()) setTitleError(null);
          }}
          className="h-11 text-base desk:h-8 desk:text-sm"
        />
      </Field>
      <Field label="Project">
        <ProjectPicker
          value={values.projectId}
          onChange={(id) => set('projectId', id)}
        />
      </Field>
      <Segmented
        legend="Status"
        value={values.status}
        onChange={(status) => set('status', status)}
        options={DECISION_STATUSES.map((s) => ({
          value: s,
          label: DECISION_LABELS[s],
        }))}
      />
      <Field
        label="Decided on"
        hint={
          values.status === 'decided' && !values.decidedAt
            ? 'Empty: today, when you save.'
            : undefined
        }
      >
        <DatePicker
          id="decision-date"
          value={values.decidedAt}
          onChange={(date) => set('decidedAt', date)}
          onInvalidChange={setDateInvalid}
        />
      </Field>
      <MemberChips
        label="Decided by"
        people={everyone}
        value={values.deciders}
        onChange={(deciders) => set('deciders', deciders)}
      />
      <Field label="Why" hint="Markdown; type / for styles, @ to mention">
        <NoteComposer
          value={values.rationale}
          onChange={(rationale) => set('rationale', rationale)}
          people={people}
          rows={5}
        />
      </Field>
      <LinksEditor
        value={values.links}
        onChange={(links) => set('links', links)}
      />
      {source && (
        <p className="text-xs text-muted-foreground">
          Made from{' '}
          <a
            {...linkProps({ name: 'notes' }, `note=${source.id}`)}
            className="underline underline-offset-4"
          >
            a note
          </a>
          .
        </p>
      )}
    </SidePanel>
  );
}

import { useMemo, useState } from 'react';
import { LIMITS } from '#shared/limits';
import type { Person } from '#shared/types';
import { Field } from '@/components/Field';
import { SidePanel, SidePanelCancel, useDirty } from '@/components/SidePanel';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useDatapad } from '@/hooks/useDatapad';
import { useToast } from '@/providers/ToastProvider';

/**
 * Edit one person: name, role, "This is me". Remove confirms and says what
 * happens to their mentions and assignments.
 */
export function PersonForm({
  person,
  open,
  onClose,
  onExited,
}: {
  person: Person;
  open: boolean;
  onClose: () => void;
  onExited: () => void;
}) {
  const { state, actions } = useDatapad();
  const { show } = useToast();
  const [initial] = useState(() => ({
    name: person.name,
    role: person.role,
    me: person.me,
  }));
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const dirty = useDirty(values, initial);

  const assigned = useMemo(
    () =>
      Object.values(state?.tasks ?? {}).filter((t) => t.assignee === person.id)
        .length,
    [state?.tasks, person.id],
  );

  const save = () => {
    const name = values.name.trim();
    if (!name) {
      setError('Give them a name');
      document.getElementById('person-name')?.focus();
      return;
    }
    const patch = Object.fromEntries(
      Object.entries({ name, role: values.role.trim(), me: values.me }).filter(
        ([k, v]) => v !== person[k as keyof Person],
      ),
    );
    if (Object.keys(patch).length) {
      if (!actions.editPerson({ id: person.id, patch })) return;
      show(`Saved ${name}`);
    }
    onClose();
  };

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      onExited={onExited}
      title={`Edit ${person.name}`}
      dirty={dirty}
      onSubmit={save}
      footer={
        confirming ? (
          <div
            role="alertdialog"
            aria-labelledby="remove-question"
            className="flex w-full flex-wrap items-center gap-2"
          >
            <p id="remove-question" className="flex-1 text-sm">
              Remove {person.name}? Mentions of them show as @unknown
              {assigned > 0
                ? ` and ${assigned === 1 ? '1 task keeps' : `${assigned} tasks keep`} the assignment.`
                : '.'}
            </p>
            <Button
              type="button"
              variant="outline"
              className="press"
              autoFocus
              onClick={() => setConfirming(false)}
            >
              Keep them
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="press"
              onClick={() => {
                if (!actions.removePerson({ id: person.id })) return;
                onClose();
                show(`Removed ${person.name}`);
              }}
            >
              Remove
            </Button>
          </div>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              className="press text-destructive"
              onClick={() => setConfirming(true)}
            >
              Remove
            </Button>
            <span className="flex-1" />
            <SidePanelCancel />
            <Button type="submit" className="press">
              Save
            </Button>
          </>
        )
      }
    >
      <Field label="Name" required error={error}>
        <Input
          id="person-name"
          value={values.name}
          maxLength={LIMITS.nameMax}
          autoComplete="off"
          className="h-11 text-base desk:h-9 desk:text-sm"
          onChange={(e) => {
            setValues((v) => ({ ...v, name: e.target.value }));
            if (error && e.target.value.trim()) setError(null);
          }}
        />
      </Field>
      <Field label="Role">
        <Input
          value={values.role}
          maxLength={LIMITS.nameMax}
          autoComplete="off"
          className="h-11 text-base desk:h-9 desk:text-sm"
          onChange={(e) => setValues((v) => ({ ...v, role: e.target.value }))}
        />
      </Field>
      <label
        htmlFor="person-me"
        className="flex min-h-11 items-center gap-2 text-sm desk:min-h-8"
      >
        <Checkbox
          id="person-me"
          checked={values.me}
          onCheckedChange={(me) =>
            setValues((v) => ({ ...v, me: me === true }))
          }
        />
        This is me
        <span className="text-xs text-muted-foreground">
          (enables the “Mine” filter)
        </span>
      </label>
    </SidePanel>
  );
}

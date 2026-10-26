import { CheckIcon, XIcon } from '@phosphor-icons/react';
import { useCallback, useId, useRef, useState } from 'react';
import { LIMITS } from '#shared/limits';
import { guessKind } from '#shared/orgs';
import { planInlineAdd } from '#shared/people';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDatapad } from '@/hooks/useDatapad';
import { cn } from '@/lib/utils';
import { useToast } from '@/providers/ToastProvider';

/** What adding by name gave: the record's id and name, and whether it is new. */
export interface Added {
  id: string;
  name: string;
  created: boolean;
}

/**
 * Add a person or an org by name, or pick the one that name already means
 * (ignoring case). A blank name does nothing; one past `LIMITS.nameMax` is
 * refused with a toast. Returns null when nothing was added or found.
 */
export function useAddByName(
  kind: 'person' | 'org',
): (raw: string) => Added | null {
  const { state, actions } = useDatapad();
  const { show } = useToast();
  return useCallback(
    (raw: string) => {
      if (!state) return null;
      const plan =
        kind === 'person'
          ? planInlineAdd(state.people, raw)
          : planInlineAdd(state.orgs, raw);
      switch (plan.kind) {
        case 'empty':
          return null;
        case 'tooLong':
          show(`Names are at most ${LIMITS.nameMax} characters.`);
          return null;
        case 'existing':
          return { id: plan.id, name: plan.name, created: false };
        case 'new': {
          const id =
            kind === 'person'
              ? actions.addPerson({ name: plan.name })
              : actions.addOrg({ name: plan.name, kind: guessKind(plan.name) });
          return id ? { id, name: plan.name, created: true } : null;
        }
      }
    },
    [state, actions, kind, show],
  );
}

/**
 * A labelled name field that adds a person (or an org) where it is needed:
 * Enter adds, Escape cancels. With `keepOpen` it clears and keeps focus so
 * several can be added in a row; otherwise it hands back and is done.
 */
export function InlineAdd({
  kind = 'person',
  label,
  onAdd,
  onCancel,
  keepOpen = false,
  className,
}: {
  kind?: 'person' | 'org';
  label: string;
  onAdd: (added: Added) => void;
  onCancel: () => void;
  keepOpen?: boolean;
  className?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const add = useAddByName(kind);

  const submit = () => {
    const added = add(text);
    if (!added) {
      input.current?.focus();
      return;
    }
    onAdd(added);
    if (keepOpen) {
      setText('');
      input.current?.focus();
    }
  };

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      <div className="flex gap-1">
        <Input
          ref={input}
          id={id}
          value={text}
          autoFocus
          autoComplete="off"
          enterKeyHint="done"
          maxLength={LIMITS.nameMax}
          placeholder="Name, then Enter"
          className="h-11 flex-1 text-base desk:h-8 desk:text-xs"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            } else if (e.key === 'Escape') {
              // Cancel the field, not the panel around it.
              e.preventDefault();
              e.stopPropagation();
              onCancel();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="press size-11 desk:size-8"
          onClick={submit}
        >
          <CheckIcon />
          <span className="sr-only">Add</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="press size-11 desk:size-8"
          onClick={onCancel}
        >
          <XIcon />
          <span className="sr-only">Cancel</span>
        </Button>
      </div>
    </div>
  );
}

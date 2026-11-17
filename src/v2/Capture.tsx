/**
 * Prototype: the one capture line. Type anything; the chips show what it
 * will become, and the kind chip flips it. Enter saves.
 */
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { formatDay } from '#shared/dates';
import { meId } from '#shared/select';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { useToday } from '@/hooks/useNow';
import { cn } from '@/lib/utils';
import { useToast } from '@/providers/ToastProvider';
import {
  CAPTURE_KINDS,
  type CaptureContext,
  type CaptureKind,
  DECIDE_TAG,
  KIND_LABELS,
  parseCapture,
  plainTitle,
} from './model';
import { Chip, personName } from './parts';

export function Capture({
  context,
  placeholder = 'Capture anything. #project @person fri, [ ] task, ? decide, waiting on @name',
  className,
}: {
  context?: CaptureContext;
  placeholder?: string;
  className?: string;
}) {
  const { state, actions } = useDatapad();
  const { show } = useToast();
  const today = useToday();
  const [text, setText] = useState('');
  const [force, setForce] = useState<CaptureKind | undefined>();
  const input = useRef<HTMLInputElement>(null);

  // `n` from anywhere outside a field puts the cursor here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      )
        return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const parsed = useMemo(
    () =>
      state && text.trim()
        ? parseCapture(text, state, today, context, force)
        : null,
    [state, text, today, context, force],
  );

  if (!state) return null;
  const me = meId(state.people);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!parsed?.text.trim()) return;
    const { kind, projectId, due, people } = parsed;
    const others = people.filter((p) => p !== me);
    let ok: unknown = null;
    if (kind === 'note') {
      ok = actions.addNote({ projectId, body: parsed.text });
    } else {
      const title = plainTitle(parsed.text, state).slice(0, 200);
      const id = actions.addTask({
        projectId,
        title,
        due,
        tags: kind === 'decide' ? [DECIDE_TAG] : [],
        assignee: kind === 'task' && others[0] ? others[0] : '',
      });
      ok = id;
      if (id && kind === 'wait') {
        actions.setBlocked({
          id,
          blocked: { on: others[0] ?? null, note: '' },
        });
      }
    }
    if (ok) {
      const where = projectId
        ? state.projects[projectId]?.name
        : kind === 'note' && people.length === 0
          ? 'Loose'
          : null;
      show(`${KIND_LABELS[kind]} saved${where ? ` to ${where}` : ''}`);
      setText('');
      setForce(undefined);
    }
  };

  const cycle = () => {
    if (!parsed) return;
    const next =
      CAPTURE_KINDS[
        (CAPTURE_KINDS.indexOf(parsed.kind) + 1) % CAPTURE_KINDS.length
      ];
    setForce(next);
  };

  return (
    <form onSubmit={submit} className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center gap-2 border border-border bg-background px-3 focus-within:border-ring">
        <span aria-hidden className="text-muted-foreground">
          +
        </span>
        <input
          ref={input}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (!e.target.value) setForce(undefined);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setText('');
              setForce(undefined);
              input.current?.blur();
            }
            if (e.key === 'Tab' && parsed && !e.shiftKey) {
              e.preventDefault();
              cycle();
            }
          }}
          placeholder={placeholder}
          aria-label="Capture"
          className="h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground desk:h-10 desk:text-sm"
        />
        <kbd className="hidden text-[11px] text-muted-foreground desk:inline">
          {parsed ? 'Tab flips · Enter saves' : 'n'}
        </kbd>
      </div>
      {parsed && (
        <div className="flex flex-wrap items-center gap-1.5" aria-live="polite">
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={cycle}
            aria-label={`Saves as ${KIND_LABELS[parsed.kind]}. Change type`}
          >
            {KIND_LABELS[parsed.kind]} ▾
          </Button>
          {parsed.projectId && (
            <Chip tone="accent">#{state.projects[parsed.projectId]?.name}</Chip>
          )}
          {parsed.people.map((p) => (
            <Chip key={p}>
              {parsed.kind === 'task' &&
              p !== me &&
              p === parsed.people.find((x) => x !== me)
                ? 'for '
                : parsed.kind === 'wait'
                  ? 'waiting on '
                  : '@'}
              {personName(state, p)}
            </Chip>
          ))}
          {parsed.due && <Chip>{formatDay(parsed.due, today)}</Chip>}
          {parsed.kind === 'note' &&
            !parsed.projectId &&
            parsed.people.length === 0 && <Chip>Loose</Chip>}
        </div>
      )}
    </form>
  );
}

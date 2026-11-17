import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react';
import { type ReactNode, useId } from 'react';
import {
  currentValues,
  optionsFor,
  PAGES,
  patchOf,
  savedPrefs,
} from '#shared/pages';
import { type ResetSection, resetSection } from '#shared/settings';
import type { PageKey, Snapshot } from '#shared/types';
import { Segmented } from '@/components/inputs/Segmented';
import { SelectField } from '@/components/inputs/SelectField';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useDatapad } from '@/hooks/useDatapad';
import { cn } from '@/lib/utils';
import { usePagePrefs } from '@/providers/PagePrefsProvider';
import { useToast } from '@/providers/ToastProvider';

/**
 * A section's Reset to defaults (#343): its options cleared and its
 * pages' saved settings dropped in one change (`resetSection`), with
 * Undo. Disabled while the section is at its defaults.
 */
export function ResetToDefaults({
  section,
  label,
}: {
  section: ResetSection;
  /** The section's name, for the toast. */
  label: string;
}) {
  const { state, actions } = useDatapad();
  const { show } = useToast();
  const reset = state ? resetSection(section, state) : null;
  return (
    <ResetButton
      disabled={!reset}
      onClick={() => {
        if (!reset || !actions.batch({ ops: reset.ops })) return;
        show(`${label} is back to its defaults`, () => {
          actions.batch({ ops: reset.undo });
        });
      }}
    />
  );
}

/** The button itself, for a section that resets something else. */
export function ResetButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      className="press h-11 self-start desk:h-8"
      disabled={disabled}
      onClick={onClick}
    >
      <ArrowCounterClockwiseIcon />
      Reset to defaults
    </Button>
  );
}

/** A group of options under its own heading. */
export function Group({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cn('flex flex-col gap-3', className)}
    >
      <h3 id={id} className="text-sm font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** A hint under an option. */
export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

/** An on or off option: its name, what it does, and a switch. 44px on touch. */
export function SwitchRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className="flex min-h-11 items-center justify-between gap-4 text-sm desk:min-h-8"
    >
      <span className="flex flex-col">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

/**
 * Some of a page's saved options (`PAGES`), with the controls the page
 * spec names, each saved at once (the default saved as nothing). `keys`
 * picks and orders them; `hints` adds a line under one.
 */
export function PageFields({
  page,
  state,
  keys,
  hints = {},
}: {
  page: PageKey;
  state: Snapshot;
  keys: readonly string[];
  hints?: Partial<Record<string, string>>;
}) {
  const { save } = usePagePrefs();
  const values = currentValues(page, savedPrefs(state, page), state);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:items-start">
      {keys.map((key) => {
        const field = PAGES[page].fields.find((f) => f.key === key);
        if (!field) return null;
        const value = values[key] ?? field.def;
        const options = optionsFor(field, state);
        const change = (next: string) =>
          save(
            page,
            patchOf({ [key]: next === field.def ? null : next }),
            true,
          );
        const hint = hints[key];
        return (
          <div
            key={key}
            className={cn(
              'flex flex-col gap-1.5',
              options.length > 3 &&
                field.control === 'segmented' &&
                'sm:col-span-2',
            )}
          >
            {field.control === 'segmented' ? (
              <Segmented
                legend={field.label}
                value={value}
                options={options}
                onChange={change}
              />
            ) : (
              <SelectField
                label={field.label}
                value={value}
                options={options}
                onChange={change}
              />
            )}
            {hint && <Hint>{hint}</Hint>}
          </div>
        );
      })}
    </div>
  );
}

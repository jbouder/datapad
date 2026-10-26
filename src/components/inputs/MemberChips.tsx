import { CheckIcon, PlusIcon } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Person } from '#shared/types';
import { InlineAdd } from '@/components/inputs/InlineAdd';
import { cn } from '@/lib/utils';

const CHIP =
  'press flex min-h-11 cursor-pointer items-center gap-1.5 border px-2.5 text-xs desk:min-h-8';

/**
 * Team members as chips that toggle: a group of real checkboxes. "Add a
 * person" at the end opens a name field; Enter adds them (or picks the
 * person that name already means) checked, and the field stays for the next.
 */
export function MemberChips({
  people,
  value,
  onChange,
  label = 'Team members',
}: {
  people: Person[];
  value: string[];
  onChange: (ids: string[]) => void;
  label?: string;
}) {
  const chosen = new Set(value);
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  // People added here enter; the rest were already on screen.
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-xs font-medium">{label}</legend>
      <div className="flex flex-wrap gap-1">
        {people.map((p) => (
          <label
            key={p.id}
            className={cn(
              CHIP,
              'has-checked:border-foreground has-checked:bg-accent has-checked:text-accent-foreground has-focus-visible:outline-2 has-focus-visible:outline-ring',
              fresh.has(p.id) && 'enter',
            )}
          >
            <input
              type="checkbox"
              className="peer sr-only"
              checked={chosen.has(p.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...value, p.id]
                    : value.filter((id) => id !== p.id),
                )
              }
            />
            <CheckIcon
              aria-hidden
              weight="bold"
              className="hidden size-3 peer-checked:block"
            />
            {p.name}
          </label>
        ))}
        {!adding && (
          <button
            ref={addButton}
            type="button"
            className={cn(
              CHIP,
              'border-dashed text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
            )}
            onClick={() => setAdding(true)}
          >
            <PlusIcon aria-hidden className="size-3" />
            Add a person
          </button>
        )}
      </div>
      {adding && (
        <InlineAdd
          label="New person’s name"
          keepOpen
          onAdd={({ id, created }) => {
            if (created) setFresh((s) => new Set(s).add(id));
            if (!chosen.has(id)) onChange([...value, id]);
          }}
          onCancel={() => {
            // Back to the chip at once, so focus never falls out of the panel.
            flushSync(() => setAdding(false));
            addButton.current?.focus();
          }}
        />
      )}
    </fieldset>
  );
}

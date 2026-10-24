import { CheckIcon } from '@phosphor-icons/react';
import type { Person } from '#shared/types';
import { cn } from '@/lib/utils';

/** Team members as chips that toggle: a group of real checkboxes. */
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
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-xs font-medium">{label}</legend>
      {people.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No people yet. Add them on the People page.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {people.map((p) => (
            <label
              key={p.id}
              className={cn(
                'press flex min-h-11 cursor-pointer items-center gap-1.5 border px-2.5 text-xs has-checked:border-foreground has-checked:bg-accent has-checked:text-accent-foreground has-focus-visible:outline-2 has-focus-visible:outline-ring desk:min-h-8',
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
        </div>
      )}
    </fieldset>
  );
}

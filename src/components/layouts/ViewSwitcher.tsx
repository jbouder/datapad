import type { Icon } from '@phosphor-icons/react';
import { useCallback, useEffect, useId } from 'react';
import type { PageKey } from '#shared/types';
import { withLayoutTransition } from '@/lib/motion';
import { shortcutAllowed } from '@/lib/shortcuts';
import { cn } from '@/lib/utils';
import { useMotion } from '@/providers/MotionProvider';
import { usePageQuery } from '@/providers/PagePrefsProvider';

export interface ViewOption<T extends string> {
  id: T;
  label: string;
  icon: Icon;
}

/**
 * The layout a collection page shows, from `?view=` (which wins), then
 * the page's saved preference (#186), then `fallback`. Setting it writes
 * the address, saves the preference and runs a `layout` view transition.
 * With no page (the components page), only the address remembers.
 */
export function useView<T extends string>(
  page: PageKey | null,
  views: readonly ViewOption<T>[],
  fallback: T,
): [T, (view: T) => void] {
  const [query, change] = usePageQuery(page, { view: fallback });
  const ids = views.map((v) => v.id) as string[];
  const asked = query.get('view');
  const view = (asked && ids.includes(asked) ? asked : fallback) as T;
  const { active } = useMotion();

  const set = useCallback(
    (next: T) => {
      change(
        { view: next },
        { replace: true, transition: (u) => withLayoutTransition(u, active) },
      );
    },
    [change, active],
  );
  return [view, set];
}

/**
 * A segmented group of layouts for a collection page (Cards · Table ·
 * Timeline …): real radios, so arrow keys move and Space picks. `v`
 * cycles through them anywhere on the page.
 */
export function ViewSwitcher<T extends string>({
  views,
  value,
  onChange,
  className,
}: {
  views: readonly ViewOption<T>[];
  value: T;
  onChange: (view: T) => void;
  className?: string;
}) {
  const name = useId();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'v' || !shortcutAllowed(event)) return;
      event.preventDefault();
      const i = views.findIndex((v) => v.id === value);
      const next = views[(i + 1) % views.length];
      if (next) onChange(next.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [views, value, onChange]);

  return (
    <fieldset className={cn('flex flex-col', className)}>
      <legend className="sr-only">Layout (press v to cycle)</legend>
      <div className="flex border border-input" title="Layout (v)">
        {views.map(({ id, label, icon: ViewIcon }) => (
          <label
            key={id}
            className="press relative flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1.5 px-2.5 text-xs not-last:border-r not-last:border-input has-checked:bg-accent has-checked:font-semibold has-checked:text-accent-foreground has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-ring desk:min-h-7.5"
          >
            <input
              type="radio"
              name={name}
              value={id}
              checked={value === id}
              onChange={() => onChange(id)}
              aria-label={label}
              className="sr-only"
            />
            <ViewIcon aria-hidden className="size-4" />
            <span aria-hidden className="max-sm:sr-only">
              {label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

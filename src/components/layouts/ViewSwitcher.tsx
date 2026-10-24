import type { Icon } from '@phosphor-icons/react';
import { useCallback, useEffect, useId } from 'react';
import { withLayoutTransition } from '@/lib/motion';
import { setQuery, useQuery } from '@/lib/router';
import { shortcutAllowed } from '@/lib/shortcuts';
import { cn } from '@/lib/utils';
import { useMotion } from '@/providers/MotionProvider';

export interface ViewOption<T extends string> {
  id: T;
  label: string;
  icon: Icon;
}

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * The layout a collection page shows, from `?view=` (which wins), then
 * what this browser last chose for the page, then `fallback`. Setting it
 * writes both and runs a `layout` view transition.
 */
export function useView<T extends string>(
  page: string,
  views: readonly ViewOption<T>[],
  fallback: T,
): [T, (view: T) => void] {
  const query = useQuery();
  const key = `datapad:view:${page}`;
  const ids = views.map((v) => v.id) as string[];
  const fromUrl = query.get('view');
  const fromStorage = stored(key);
  const view = (
    fromUrl && ids.includes(fromUrl)
      ? fromUrl
      : fromStorage && ids.includes(fromStorage)
        ? fromStorage
        : fallback
  ) as T;
  const { active } = useMotion();

  const set = useCallback(
    (next: T) => {
      try {
        localStorage.setItem(key, next);
      } catch {
        // Remembered in the URL only.
      }
      setQuery(
        { view: next },
        { replace: true, transition: (u) => withLayoutTransition(u, active) },
      );
    },
    [key, active],
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
      <div
        className="flex outline -outline-offset-1 outline-input"
        title="Layout (v)"
      >
        {views.map(({ id, label, icon: ViewIcon }) => (
          <label
            key={id}
            className="press relative flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1.5 px-2.5 text-xs not-last:border-r has-checked:bg-accent has-checked:font-semibold has-checked:text-accent-foreground has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-ring desk:min-h-8"
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

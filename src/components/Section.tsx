import { CaretRightIcon } from '@phosphor-icons/react';
import { type ReactNode, useId, useState } from 'react';
import type { PageKey } from '#shared/types';
import { holdFlip } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useOpening, usePagePrefs } from '@/providers/PagePrefsProvider';

/** Where a section's open or closed is saved: its page's preferences. */
export interface RememberSection {
  page: PageKey;
  key: string;
}

/**
 * A titled section whose header is a button with `aria-expanded`. With
 * `remember`, open or closed is saved with the page's preferences (#186),
 * so it follows you to every device; only a state other than
 * `defaultOpen` is kept. Pass `open` to override it (a section opened to
 * show what was just added).
 *
 * The only motion is the caret turning: the body appears and goes at
 * once (nothing inside it replays its entrance), and the header has no
 * press scale, which on a full-width row read as a jump sideways.
 */
export function Section({
  title,
  count,
  remember,
  defaultOpen = true,
  actions,
  open: forced,
  onToggle,
  className,
  children,
}: {
  title: string;
  count?: number;
  remember?: RememberSection;
  defaultOpen?: boolean;
  /** Controls on the right of the header (outside the toggle). */
  actions?: ReactNode;
  /** Shown open regardless of the remembered state while true. */
  open?: boolean;
  /** After the header is clicked, with the new state. */
  onToggle?: (open: boolean) => void;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const prefs = usePagePrefs();
  const saved = useOpening(({ read }) =>
    remember ? read(remember.page).sections?.[remember.key] : undefined,
  );
  /** Toggled here; until then, what is saved. */
  const [chosen, setOpen] = useState<boolean | null>(null);
  const remembered = chosen ?? saved ?? defaultOpen;
  /** Opened by a click just now: its contents appear without entrances. */
  const [opening, setOpening] = useState(false);
  const open = forced || remembered;
  const toggle = () => {
    const next = !open;
    holdFlip();
    setOpening(next);
    // A moment later, whatever is added enters as usual.
    if (next) window.setTimeout(() => setOpening(false), 250);
    setOpen(next);
    if (remember) {
      prefs.save(remember.page, {
        sections: { [remember.key]: next === defaultOpen ? null : next },
      });
    }
    onToggle?.(next);
  };
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn('flex flex-col', className)}
    >
      <div className="flex items-center gap-2">
        <h2 id={`${id}-title`} className="flex min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`${id}-body`}
            onClick={toggle}
            className="-ml-1 flex min-h-11 flex-1 items-center gap-1.5 px-1 text-left font-heading text-sm font-semibold outline-ring/50 focus-visible:outline-2 desk:min-h-8"
          >
            <CaretRightIcon
              weight="bold"
              aria-hidden
              className={cn(
                'size-3.5 transition-transform duration-(--duration-fast)',
                open && 'rotate-90',
              )}
            />
            <span>{title}</span>
            {count !== undefined && (
              <span className="count font-sans text-xs font-normal text-muted-foreground tabular-nums">
                {count}
              </span>
            )}
          </button>
        </h2>
        {actions}
      </div>
      <div
        id={`${id}-body`}
        hidden={!open}
        className="section-body"
        data-opening={opening || undefined}
      >
        {children}
      </div>
    </section>
  );
}

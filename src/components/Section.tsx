import { CaretRightIcon } from '@phosphor-icons/react';
import { type ReactNode, useId, useState } from 'react';
import { holdFlip } from '@/lib/motion';
import { cn } from '@/lib/utils';

function read(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === 'open';
  } catch {
    return fallback;
  }
}

/**
 * A titled section whose header is a button with `aria-expanded`. With
 * `storageKey`, open or closed is remembered in this browser. Pass `open`
 * to override it (a section opened to show what was just added).
 *
 * Motion is minimal on purpose: the caret turns, an opening body fades in
 * quickly (nothing inside it replays its entrance) and closing is
 * instant; what moves below it jumps rather than sliding.
 */
export function Section({
  title,
  count,
  storageKey,
  defaultOpen = true,
  actions,
  open: forced,
  onToggle,
  className,
  children,
}: {
  title: string;
  count?: number;
  storageKey?: string;
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
  const [remembered, setOpen] = useState(() =>
    storageKey ? read(storageKey, defaultOpen) : defaultOpen,
  );
  /** Opened by a click just now: its contents appear without entrances. */
  const [opening, setOpening] = useState(false);
  const open = forced || remembered;
  const toggle = () => {
    const next = !open;
    holdFlip();
    setOpening(next);
    // Past the fade: whatever is added later enters as usual.
    if (next) window.setTimeout(() => setOpening(false), 250);
    setOpen(next);
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, next ? 'open' : 'closed');
      } catch {
        // Not remembered; it still toggles.
      }
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
            className="press -ml-1 flex min-h-11 flex-1 items-center gap-1.5 px-1 text-left font-heading text-sm font-semibold outline-ring/50 focus-visible:outline-2 desk:min-h-8"
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

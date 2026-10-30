import { XIcon } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { shortcutAllowed } from '@/lib/shortcuts';
import { cn } from '@/lib/utils';

/** How long typing in Find waits before the list follows. */
export const FIND_DEBOUNCE_MS = 150;

/**
 * A list page's Find box (#269): a labeled search field whose text reaches
 * the page (`?q=`) a moment after typing stops, with a clear button. `f`
 * anywhere on the page goes to it (one Find per page); Esc in it clears
 * it, then leaves it. `value` is the page's (the address), which the box
 * follows when it changes from outside (Back, Clear filters).
 */
export function FindField({
  value,
  onChange,
  placeholder,
  label = 'Find',
  className,
}: {
  value: string;
  /** The text, `''` when empty; after the pause, or at once on clear. */
  onChange: (text: string) => void;
  /** What the page searches ("Title, details or tag"). */
  placeholder: string;
  label?: string;
  className?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  // The last text sent, so the page's echo of it is not taken as news.
  const sent = useRef(value);

  // The box follows the page (Back, Clear filters).
  useEffect(() => {
    if (value !== sent.current) {
      sent.current = value;
      setText(value);
    }
  }, [value]);

  // The page follows the box after a pause.
  useEffect(() => {
    if (text === sent.current) return;
    const timer = window.setTimeout(() => {
      sent.current = text;
      changeRef.current(text);
    }, FIND_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text]);

  // `f` goes to Find.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'f' || !shortcutAllowed(event)) return;
      event.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const clear = () => {
    setText('');
    if (sent.current !== '') {
      sent.current = '';
      changeRef.current('');
    }
  };

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      <div className="relative">
        <Input
          ref={input}
          id={id}
          type="search"
          value={text}
          placeholder={placeholder}
          autoComplete="off"
          title={`${label} (f)`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            // Ours, not the page's (a selection, an open card) nor the
            // browser's own clearing.
            e.preventDefault();
            e.stopPropagation();
            if (text) clear();
            else input.current?.blur();
          }}
          className={cn(
            'h-11 text-base desk:h-8 desk:text-xs [&::-webkit-search-cancel-button]:appearance-none',
            text && 'pr-11 desk:pr-8',
          )}
        />
        {text && (
          <button
            type="button"
            aria-label={`Clear ${label}`}
            onClick={() => {
              clear();
              input.current?.focus();
            }}
            className="press absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring desk:w-8"
          >
            <XIcon aria-hidden className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}

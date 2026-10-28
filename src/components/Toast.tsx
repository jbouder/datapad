import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { focusPage } from '@/lib/focus';

export interface ToastMessage {
  id: string;
  text: string;
  undo?: () => void;
  /** Another follow-up, such as Open. */
  action?: ToastAction;
}

export interface ToastAction {
  label: string;
  run: () => void;
}

interface ToastProps {
  message: ToastMessage | null;
  onDismiss: () => void;
}

/**
 * Enter and exit are pure CSS: `.toast` transitions from display:none with
 * `@starting-style` and `transition-behavior: allow-discrete` (see index.css).
 * The element always exists; React only toggles the `open` class and content.
 *
 * It goes after five seconds, but not while focus is inside it, so a
 * keyboard user can reach Undo in their own time. Using a button gives
 * focus back to where it came from (or the page), never to `<body>`.
 */
export function Toast({ message, onDismiss }: ToastProps) {
  const root = useRef<HTMLOutputElement>(null);
  /** Where focus was before it came into the toast. */
  const cameFrom = useRef<HTMLElement | null>(null);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!message || held) {
      return;
    }
    const timer = window.setTimeout(onDismiss, 5000);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss, held]);

  const done = (run?: () => void) => {
    run?.();
    const back = cameFrom.current;
    cameFrom.current = null;
    setHeld(false);
    if (back?.isConnected) back.focus({ preventScroll: true });
    else focusPage();
    onDismiss();
  };

  return (
    <output
      ref={root}
      className={`toast ${message ? 'open' : ''}`}
      aria-live="polite"
      onFocus={(event) => {
        if (!held) {
          const from = event.relatedTarget;
          cameFrom.current =
            from instanceof HTMLElement && !root.current?.contains(from)
              ? from
              : null;
          setHeld(true);
        }
      }}
      onBlur={(event) => {
        if (!root.current?.contains(event.relatedTarget as Node | null)) {
          cameFrom.current = null;
          setHeld(false);
        }
      }}
    >
      <span className="min-w-0 flex-1 truncate text-sm">{message?.text}</span>
      {message?.undo && (
        <Button
          size="sm"
          variant="secondary"
          className="press"
          onClick={() => done(message.undo)}
        >
          Undo
        </Button>
      )}
      {message?.action && (
        <Button
          size="sm"
          variant="secondary"
          className="press"
          onClick={() => done(message.action?.run)}
        >
          {message.action.label}
        </Button>
      )}
    </output>
  );
}

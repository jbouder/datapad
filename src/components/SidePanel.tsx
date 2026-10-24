import { Dialog } from '@base-ui/react/dialog';
import { XIcon } from '@phosphor-icons/react';
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Button } from '@/components/ui/button';

/**
 * The slide-over every editor uses (task, project, event, person,
 * summary): 460px from the right, the whole screen on phones, a scrim
 * behind. Focus goes to the first field on open and back to whatever
 * opened it on close; the page behind does not scroll. Esc, the scrim and
 * Cancel all ask first when `dirty`; ⌘/Ctrl+Enter submits from anywhere.
 */

interface PanelContext {
  /** Close, asking first if there are unsaved changes. */
  requestClose: () => void;
}

const SidePanelContext = createContext<PanelContext | null>(null);

export function useSidePanel(): PanelContext {
  const value = useContext(SidePanelContext);
  if (!value) throw new Error('useSidePanel must be used inside SidePanel');
  return value;
}

const FIELDS =
  'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [role="combobox"]:not([aria-disabled="true"])';

export function SidePanel({
  open,
  onClose,
  onExited,
  title,
  description,
  dirty = false,
  onSubmit,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** After the exit transition: unmount whatever owns the panel now. */
  onExited?: () => void;
  title: string;
  description?: string;
  /** Unsaved changes: closing asks first. */
  dirty?: boolean;
  /** The body is a form; Enter in a field and ⌘/Ctrl+Enter submit it. */
  onSubmit?: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const popup = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const [asking, setAsking] = useState(false);

  // Remember who opened us, to hand focus back.
  useEffect(() => {
    if (open) {
      opener.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    } else {
      setAsking(false);
    }
  }, [open]);

  useEffect(() => {
    if (asking) keep.current?.focus();
  }, [asking]);

  const requestClose = useCallback(() => {
    if (dirty) setAsking(true);
    else onClose();
  }, [dirty, onClose]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    onSubmit?.();
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) onExited?.();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="scrim" />
        <Dialog.Popup
          ref={popup}
          className="side-panel"
          initialFocus={() =>
            popup.current?.querySelector<HTMLElement>(FIELDS) ?? true
          }
          finalFocus={() =>
            opener.current?.isConnected ? opener.current : true
          }
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              (event.metaKey || event.ctrlKey) &&
              onSubmit
            ) {
              event.preventDefault();
              form.current?.requestSubmit();
            }
          }}
        >
          <SidePanelContext.Provider value={{ requestClose }}>
            <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
              <Dialog.Title className="min-w-0 flex-1 truncate font-heading text-base font-semibold">
                {title}
              </Dialog.Title>
              <Button
                variant="ghost"
                size="icon"
                className="press size-11 desk:size-9"
                onClick={requestClose}
              >
                <XIcon weight="bold" />
                <span className="sr-only">Close</span>
              </Button>
            </header>
            {description && (
              <Dialog.Description className="sr-only">
                {description}
              </Dialog.Description>
            )}
            <form
              ref={form}
              onSubmit={submit}
              noValidate
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
                {children}
              </div>
              {asking ? (
                <div
                  role="alertdialog"
                  aria-labelledby="discard-title"
                  className="flex shrink-0 flex-wrap items-center gap-2 border-t bg-muted px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
                >
                  <p id="discard-title" className="flex-1 text-sm">
                    Discard your changes?
                  </p>
                  <Button
                    ref={keep}
                    type="button"
                    variant="outline"
                    className="press"
                    onClick={() => setAsking(false)}
                  >
                    Keep editing
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    className="press"
                    onClick={onClose}
                  >
                    Discard
                  </Button>
                </div>
              ) : (
                footer && (
                  <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
                    {footer}
                  </footer>
                )
              )}
            </form>
          </SidePanelContext.Provider>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A footer Cancel that asks first when there are unsaved changes. */
export function SidePanelCancel() {
  const { requestClose } = useSidePanel();
  return (
    <Button
      type="button"
      variant="ghost"
      className="press"
      onClick={requestClose}
    >
      Cancel
    </Button>
  );
}

/** Whether a form's values differ from the ones it opened with. */
export function useDirty<T>(values: T, initial: T): boolean {
  return JSON.stringify(values) !== JSON.stringify(initial);
}

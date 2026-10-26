import { CaretUpDownIcon, GearSixIcon, PlusIcon } from '@phosphor-icons/react';
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { LIMITS } from '#shared/limits';
import { validSpaceName } from '#shared/spaces';
import { Field } from '@/components/Field';
import { DatapadMark } from '@/components/TopBar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { linkProps } from '@/lib/router';
import { useSpaces } from '@/providers/DatapadProvider';

/** Menu rows: 44px to a finger, the menu's own size to a mouse. */
export const SPACE_ROW = 'min-h-11 desk:min-h-0';

/**
 * The desktop rail's header: the brand mark and the open space's name,
 * opening the list of spaces (a radio group), New space… and Manage
 * spaces. Focus has its own link in the nav just below, so the header is
 * the switcher. Phones switch from the account menu.
 */
export function SpaceSwitcher() {
  const { spaces, current, switchSpace } = useSpaces();
  const { openNewSpace } = useNewSpace();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Space: ${current.name}`}
            className="press flex h-14 w-full shrink-0 items-center gap-2 px-4 text-left font-heading text-base font-semibold tracking-tight outline-ring/50 hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:-outline-offset-2 data-popup-open:bg-sidebar-accent"
          />
        }
      >
        <DatapadMark className="size-6 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{current.name}</span>
        <CaretUpDownIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Spaces</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={current.id}
            onValueChange={switchSpace}
          >
            {spaces.map((s) => (
              <DropdownMenuRadioItem
                key={s.id}
                value={s.id}
                closeOnClick
                className={SPACE_ROW}
              >
                <span className="truncate">{s.name}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem className={SPACE_ROW} onClick={openNewSpace}>
            <PlusIcon />
            New space…
          </DropdownMenuItem>
          <DropdownMenuItem
            className={SPACE_ROW}
            render={
              <a {...linkProps({ name: 'settings', section: 'spaces' })} />
            }
          >
            <GearSixIcon />
            Manage spaces
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface NewSpace {
  /** Ask for a name, make the space and open it. */
  openNewSpace: () => void;
}

const NewSpaceContext = createContext<NewSpace | null>(null);

/**
 * The one "New space" dialog, opened from the rail switcher, Settings →
 * Spaces or ⌘K. Inside `DatapadProvider` and `ToastProvider`.
 */
export function NewSpaceProvider({ children }: { children: ReactNode }) {
  const { spaces, createSpace } = useSpaces();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openNewSpace = useCallback(() => {
    setName('');
    setError(null);
    setOpen(true);
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const check = validSpaceName(name, spaces);
    if (!check.ok) {
      setError(check.reason);
      return;
    }
    setBusy(true);
    // A refusal (the server's own checks, the limit) is toasted.
    const ok = await createSpace(check.name);
    setBusy(false);
    if (ok) setOpen(false);
  };

  const value = useMemo(() => ({ openNewSpace }), [openNewSpace]);

  return (
    <NewSpaceContext.Provider value={value}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={save} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>New space</DialogTitle>
              <DialogDescription>
                A separate Datapad: its own projects, tasks, notes, meetings and
                people.
              </DialogDescription>
            </DialogHeader>
            <Field label="Name" error={error}>
              <Input
                value={name}
                maxLength={LIMITS.spaceNameMax}
                autoComplete="off"
                autoFocus
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                className="h-11 text-base desk:h-8 desk:text-xs"
              />
            </Field>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                Cancel
              </DialogClose>
              <Button type="submit" className="press" disabled={busy}>
                Create space
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </NewSpaceContext.Provider>
  );
}

export function useNewSpace(): NewSpace {
  const value = useContext(NewSpaceContext);
  if (!value) throw new Error('useNewSpace needs NewSpaceProvider');
  return value;
}

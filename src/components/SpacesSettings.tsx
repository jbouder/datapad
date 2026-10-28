import {
  ArrowDownIcon,
  ArrowUpIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { LIMITS } from '#shared/limits';
import { type Counts, countDocuments, ExportSchema } from '#shared/protocol';
import { validSpaceName } from '#shared/spaces';
import type { SpaceInfo } from '#shared/types';
import { Field } from '@/components/Field';
import { describeCounts } from '@/components/ImportExport';
import { SidePanel } from '@/components/SidePanel';
import { useNewSpace } from '@/components/SpaceSwitcher';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDatapad } from '@/hooks/useDatapad';
import {
  deleteSpace,
  fetchExport,
  RefusedError,
  renameSpace,
  reorderSpaces,
  SignedOutError,
  spaceDeleteToken,
} from '@/lib/api';
import { useSpaces } from '@/providers/DatapadProvider';
import { useToast } from '@/providers/ToastProvider';

const ICON_BUTTON = 'press size-11 desk:size-8';

function message(error: unknown, fallback: string): string {
  // Signed out: the app shows "Sign in again" in place of this.
  if (error instanceof SignedOutError) return fallback;
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Settings → Spaces: every space in switcher order, to rename in place,
 * move up or down, or delete (typed name first). New space opens the same
 * dialog as the switcher. Changes come back through the socket's `spaces`
 * message, so the list here and the switcher update together.
 */
export function SpacesSettings() {
  const { spaces, current } = useSpaces();
  const { openNewSpace } = useNewSpace();
  const { show } = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SpaceInfo | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const deleted = useRef(false);
  const newButton = useRef<HTMLButtonElement>(null);
  // What was just sent, shown until the server's list arrives.
  const [pending, setPending] = useState<{
    names: Record<string, string>;
    order: string[] | null;
  }>({ names: {}, order: null });
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new list from the server replaces what was pending
  useEffect(() => {
    setPending({ names: {}, order: null });
  }, [spaces]);

  const byId = new Map(spaces.map((s) => [s.id, s]));
  const shown = (
    pending.order ? pending.order.flatMap((id) => byId.get(id) ?? []) : spaces
  ).map((s) => (pending.names[s.id] ? { ...s, name: pending.names[s.id] } : s));
  const only = spaces.length <= 1;

  const move = async (id: string, by: -1 | 1) => {
    const ids = shown.map((s) => s.id);
    const from = ids.indexOf(id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    setPending((p) => ({ ...p, order: ids }));
    try {
      await reorderSpaces(ids);
    } catch (error) {
      setPending((p) => ({ ...p, order: null }));
      show(message(error, 'Could not move that space. Try again.'));
    }
  };

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Each space is a separate Datapad: its own projects, tasks, notes,
        meetings, people, templates and backups. The switcher lists them in this
        order.
      </p>
      <Button
        ref={newButton}
        variant="outline"
        className="press self-start"
        onClick={openNewSpace}
      >
        <PlusIcon />
        New space
      </Button>
      <ul aria-label="Spaces" className="flex flex-col border-t">
        {shown.map((s, i) => (
          <SpaceRow
            key={s.id}
            space={s}
            spaces={spaces}
            open={s.id === current.id}
            first={i === 0}
            last={i === shown.length - 1}
            only={only}
            editing={editing === s.id}
            onEdit={(on) => setEditing(on ? s.id : null)}
            onRenamed={(name) =>
              setPending((p) => ({
                ...p,
                names: { ...p.names, [s.id]: name },
              }))
            }
            onMove={(by) => move(s.id, by)}
            onDelete={() => {
              deleted.current = false;
              setDeleting(s);
              setPanelOpen(true);
            }}
          />
        ))}
      </ul>
      {only && (
        <p id="last-space-hint" className="text-xs text-muted-foreground">
          The last space cannot be deleted. Make another one first.
        </p>
      )}
      {deleting && (
        <DeleteSpacePanel
          key={deleting.id}
          space={deleting}
          active={deleting.id === current.id}
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          onDeleted={() => {
            deleted.current = true;
            setPanelOpen(false);
          }}
          // Its row is gone: land on New space rather than the page.
          returnFocus={() => (deleted.current ? newButton.current : null)}
          onExited={() => setDeleting(null)}
        />
      )}
    </>
  );
}

function SpaceRow({
  space,
  spaces,
  open,
  first,
  last,
  only,
  editing,
  onEdit,
  onRenamed,
  onMove,
  onDelete,
}: {
  space: SpaceInfo;
  spaces: SpaceInfo[];
  /** The space this tab has open. */
  open: boolean;
  first: boolean;
  last: boolean;
  only: boolean;
  editing: boolean;
  onEdit: (on: boolean) => void;
  onRenamed: (name: string) => void;
  onMove: (by: -1 | 1) => void;
  onDelete: () => void;
}) {
  const nameButton = useRef<HTMLButtonElement>(null);
  const upButton = useRef<HTMLButtonElement>(null);
  const downButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);

  // Back to the name after a rename, so the keyboard carries on.
  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false;
      nameButton.current?.focus();
    }
  }, [editing]);

  // A move to the top or bottom disables the button just pressed: hand
  // focus to the other one rather than losing it.
  useEffect(() => {
    const active = document.activeElement;
    if (first && active === upButton.current) downButton.current?.focus();
    if (last && active === downButton.current) upButton.current?.focus();
  }, [first, last]);

  const stop = () => {
    refocus.current = true;
    onEdit(false);
  };

  return (
    <li
      aria-current={open ? 'true' : undefined}
      className="row flex items-center gap-1 border-b text-sm"
    >
      {editing ? (
        <RenameForm
          space={space}
          spaces={spaces}
          onDone={(name) => {
            if (name) onRenamed(name);
            stop();
          }}
        />
      ) : (
        <>
          <button
            ref={nameButton}
            type="button"
            onClick={() => onEdit(true)}
            aria-label={`${space.name}, rename`}
            className="flex min-h-11 min-w-0 flex-1 items-center text-left outline-ring/50 focus-visible:outline-2 desk:min-h-8"
          >
            <span className="truncate font-medium hover:underline">
              {space.name}
            </span>
          </button>
          {open && (
            <span className="shrink-0 border px-1.5 py-0.5 text-xs text-muted-foreground">
              Open
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={ICON_BUTTON}
            title="Rename"
            onClick={() => onEdit(true)}
          >
            <PencilSimpleIcon />
            <span className="sr-only">Rename {space.name}</span>
          </Button>
        </>
      )}
      <Button
        ref={upButton}
        variant="ghost"
        size="icon"
        className={ICON_BUTTON}
        title="Move up"
        disabled={first}
        onClick={() => onMove(-1)}
      >
        <ArrowUpIcon />
        <span className="sr-only">Move {space.name} up</span>
      </Button>
      <Button
        ref={downButton}
        variant="ghost"
        size="icon"
        className={ICON_BUTTON}
        title="Move down"
        disabled={last}
        onClick={() => onMove(1)}
      >
        <ArrowDownIcon />
        <span className="sr-only">Move {space.name} down</span>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={`${ICON_BUTTON} text-destructive`}
        title="Delete…"
        disabled={only}
        aria-describedby={only ? 'last-space-hint' : undefined}
        onClick={onDelete}
      >
        <TrashIcon />
        <span className="sr-only">Delete {space.name}…</span>
      </Button>
    </li>
  );
}

/** The name in place: Enter saves, Esc (or leaving it) puts it back. */
function RenameForm({
  space,
  spaces,
  onDone,
}: {
  space: SpaceInfo;
  spaces: SpaceInfo[];
  /** With the new name when it was saved, without when not. */
  onDone: (name?: string) => void;
}) {
  const [name, setName] = useState(space.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const check = validSpaceName(name, spaces, space.id);
    if (!check.ok) {
      setError(check.reason);
      return;
    }
    if (check.name === space.name) {
      onDone();
      return;
    }
    setBusy(true);
    try {
      await renameSpace(space.id, check.name);
      onDone(check.name);
    } catch (error) {
      setBusy(false);
      setError(message(error, 'Could not rename it. Try again.'));
    }
  };

  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onDone();
    }
  };

  return (
    <form onSubmit={save} className="min-w-0 flex-1 py-1">
      <Field label={`Name of ${space.name}`} labelHidden error={error}>
        <Input
          value={name}
          maxLength={LIMITS.spaceNameMax}
          autoComplete="off"
          enterKeyHint="done"
          autoFocus
          disabled={busy}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={keys}
          onBlur={() => {
            if (!busy) onDone();
          }}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          className="h-11 text-base desk:h-8 desk:text-sm"
        />
      </Field>
    </form>
  );
}

type Contents =
  | { state: 'loading' }
  | { state: 'counted'; counts: Counts }
  | { state: 'unknown' };

/**
 * Delete a space: what goes with it, its name typed exactly, then a fresh
 * one-time token and the delete. The whole screen on phones, like every
 * panel. Deleting the open space moves this tab to the first one (the
 * provider does that when the socket closes).
 */
function DeleteSpacePanel({
  space,
  active,
  open,
  onClose,
  onDeleted,
  onExited,
  returnFocus,
}: {
  space: SpaceInfo;
  active: boolean;
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
  onExited: () => void;
  returnFocus: () => HTMLElement | null;
}) {
  const { state } = useDatapad();
  const { show } = useToast();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [other, setOther] = useState<Contents>({ state: 'loading' });

  // Another space's contents are not here: count its export.
  useEffect(() => {
    if (active) return;
    let current = true;
    fetchExport(space.id)
      .then((text) => {
        const parsed = ExportSchema.safeParse(JSON.parse(text));
        if (!parsed.success) throw new Error('Not an export');
        const { exportedAt: _, ...documents } = parsed.data;
        if (current) {
          setOther({ state: 'counted', counts: countDocuments(documents) });
        }
      })
      .catch(() => {
        if (current) setOther({ state: 'unknown' });
      });
    return () => {
      current = false;
    };
  }, [active, space.id]);

  const contents: Contents = active
    ? state
      ? { state: 'counted', counts: countDocuments(state) }
      : { state: 'loading' }
    : other;
  const matches = typed === space.name;

  const submit = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Asked for right before it is used: it lasts minutes, once.
      const { token } = await spaceDeleteToken(space.id);
      await deleteSpace(space.id, token);
      show(`Deleted ${space.name}`);
      onDeleted();
    } catch (error) {
      setBusy(false);
      setError(
        error instanceof RefusedError && error.status === 403
          ? 'That confirmation expired before it was used. Nothing was deleted. Delete again to try with a fresh one.'
          : message(error, 'Could not delete it. Nothing was deleted.'),
      );
    }
  };

  return (
    <SidePanel
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      onExited={onExited}
      returnFocus={returnFocus}
      title={`Delete ${space.name}?`}
      description={`Delete ${space.name} and everything in it.`}
      onSubmit={submit}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            className="press h-11 desk:h-8"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="outline"
            className="press h-11 text-destructive desk:h-8"
            disabled={!matches || busy}
          >
            {busy ? 'Deleting…' : 'Delete space'}
          </Button>
        </>
      }
    >
      <p className="text-sm">
        {contents.state === 'counted' ? (
          <>
            This deletes {space.name} and everything in it:{' '}
            {describeCounts(contents.counts)}, and its templates.
          </>
        ) : contents.state === 'loading' ? (
          <>Counting what is in {space.name}…</>
        ) : (
          <>
            This deletes {space.name} and everything in it. What is in it could
            not be counted just now.
          </>
        )}{' '}
        Its nightly backups stay in your R2 bucket, but this cannot be undone
        here: export it first to keep a copy.
      </p>
      {active && (
        <p className="text-sm text-muted-foreground">
          It is the space open here; the first space opens after.
        </p>
      )}
      <Field label={`Type ${space.name} to confirm`} error={error}>
        <Input
          value={typed}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={busy}
          onChange={(e) => {
            setTyped(e.target.value);
            setError(null);
          }}
          className="h-11 text-base desk:h-8 desk:text-sm"
        />
      </Field>
    </SidePanel>
  );
}

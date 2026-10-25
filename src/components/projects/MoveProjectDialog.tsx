import { type FormEvent, useState } from 'react';
import type { SpaceInfo } from '#shared/types';
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
import { cn } from '@/lib/utils';

/**
 * "Move to…" on a project: the other spaces as a radio group (44px rows
 * to a finger), then Move. `onMove` does the moving and says whether it
 * worked; the dialog stays open, with the choice, when it did not.
 */
export function MoveProjectDialog({
  open,
  onOpenChange,
  projectName,
  spaces,
  onMove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  /** The spaces it can go to: every one but the open one. */
  spaces: SpaceInfo[];
  onMove: (to: SpaceInfo) => Promise<boolean>;
}) {
  const [picked, setTo] = useState<string>('');
  const [busy, setBusy] = useState(false);
  // Each time it opens, start on the first space (also when the one
  // picked has just been deleted elsewhere).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setTo('');
  }
  const to = spaces.some((s) => s.id === picked)
    ? picked
    : (spaces[0]?.id ?? '');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const space = spaces.find((s) => s.id === to);
    if (!space || busy) return;
    setBusy(true);
    const moved = await onMove(space);
    setBusy(false);
    if (moved) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Move to another space</DialogTitle>
            <DialogDescription>
              {projectName} goes with its tasks, notes, events, decisions and
              activity. Its people and org are copied.
            </DialogDescription>
          </DialogHeader>
          <fieldset className="flex flex-col gap-1" disabled={busy}>
            <legend className="mb-1.5 text-xs font-medium">Space</legend>
            {spaces.map((s) => {
              const selected = s.id === to;
              return (
                <label
                  key={s.id}
                  className={cn(
                    'press flex min-h-11 cursor-pointer items-center gap-2 border px-3 text-sm outline-ring/50 has-focus-visible:outline-2 desk:min-h-9',
                    selected
                      ? 'border-foreground bg-muted/40'
                      : 'hover:bg-muted/40',
                  )}
                >
                  <input
                    type="radio"
                    name="move-to-space"
                    value={s.id}
                    checked={selected}
                    onChange={() => setTo(s.id)}
                    className="size-4 accent-foreground"
                  />
                  <span className="min-w-0 truncate">{s.name}</span>
                </label>
              );
            })}
          </fieldset>
          <DialogFooter>
            <DialogClose
              render={
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 desk:h-8"
                />
              }
            >
              Cancel
            </DialogClose>
            <Button
              type="submit"
              className="press h-11 desk:h-8"
              disabled={busy || !to}
            >
              Move
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

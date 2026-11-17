import {
  BookmarkSimpleIcon,
  DotsThreeIcon,
  PencilSimpleIcon,
  PushPinIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { type FormEvent, useState } from 'react';
import { addView, removeView, renameView, viewRoute } from '#shared/all';
import { newId } from '#shared/ids';
import { LIMITS } from '#shared/limits';
import { savedViews } from '#shared/rooms';
import type { SavedView } from '#shared/types';
import { Field } from '@/components/Field';
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
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useDatapad } from '@/hooks/useDatapad';
import { usePins } from '@/hooks/usePins';
import { linkProps } from '@/lib/router';
import { cn } from '@/lib/utils';
import { useToast } from '@/providers/ToastProvider';

const CHIP =
  'press flex h-11 items-center gap-1.5 border px-3 text-xs outline-ring/50 focus-visible:outline-2 focus-visible:-outline-offset-2 desk:h-8';

/**
 * All's saved views (#338): chips above the list, each a link to the
 * address it saved, with a menu to rename it, pin it to the rail or delete
 * it, and Save view, which names what All shows now. They are kept in
 * `settings.pages.all.views` (one `setPagePrefs` per change, so they sync
 * to every device at once); Delete offers Undo.
 */
export function SavedViews({
  query,
  current,
}: {
  /** What Save view saves: All's address now (`viewQuery`). */
  query: string;
  /** The saved view All shows now, if any. */
  current?: SavedView;
}) {
  const { state, actions } = useDatapad();
  const { pinned, setPinned } = usePins();
  const { show } = useToast();
  const [editing, setEditing] = useState<SavedView | 'new' | null>(null);
  const [name, setName] = useState('');
  if (!state) return null;
  const views = savedViews(state);
  const full = views.length >= LIMITS.viewsMax;

  const write = (next: SavedView[]) =>
    actions.setPagePrefs({
      page: 'all',
      patch: { views: next.length > 0 ? next : null },
    });

  const open = (view: SavedView | 'new') => {
    setName(view === 'new' ? '' : view.name);
    setEditing(view);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !editing) return;
    if (editing === 'new') {
      if (!write(addView(views, { id: newId(), name: trimmed, query }))) {
        return;
      }
      show(`Saved the view “${trimmed}”`);
    } else {
      if (!write(renameView(views, editing.id, trimmed))) return;
      show(`Renamed the view to “${trimmed}”`);
    }
    setEditing(null);
  };

  const remove = (view: SavedView) => {
    const before = views;
    if (!write(removeView(views, view.id))) return;
    show(`Deleted the view “${view.name}”`, () => write(before));
  };

  return (
    <section
      aria-label="Saved views"
      className="-mx-4 min-w-0 overflow-x-auto px-4 sm:mx-0 sm:px-0"
    >
      <ul className="flex w-max items-center gap-2 pr-4 sm:w-auto sm:flex-wrap sm:pr-0">
        {views.map((view) => {
          const to = viewRoute(view.query);
          const here = current?.id === view.id;
          const room = { kind: 'view' as const, id: view.id };
          const isPinned = pinned(room);
          return (
            <li key={view.id} className="flex">
              <a
                {...linkProps(to.route, to.query)}
                aria-current={here ? 'page' : undefined}
                className={cn(
                  CHIP,
                  'border-r-0',
                  here && 'bg-accent font-semibold text-accent-foreground',
                )}
              >
                {isPinned && (
                  <PushPinIcon weight="fill" aria-hidden className="size-3" />
                )}
                {view.name}
              </a>
              <DropdownMenu>
                <DropdownMenuTrigger
                  className={cn(CHIP, 'w-11 justify-center px-0 desk:w-8')}
                  aria-label={`Options for ${view.name}`}
                >
                  <DotsThreeIcon aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  <DropdownMenuItem onClick={() => open(view)}>
                    <PencilSimpleIcon />
                    Rename…
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setPinned(room, !isPinned)}>
                    <PushPinIcon />
                    {isPinned ? 'Unpin from the rail' : 'Pin to the rail'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => remove(view)}
                  >
                    <TrashIcon />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          );
        })}
        <li>
          <Button
            variant="ghost"
            className="press h-11 desk:h-8"
            disabled={full || current !== undefined}
            title={
              full
                ? `${LIMITS.viewsMax} saved views at most`
                : current
                  ? `Saved as “${current.name}”`
                  : undefined
            }
            onClick={() => open('new')}
          >
            <BookmarkSimpleIcon aria-hidden />
            Save view
          </Button>
        </li>
      </ul>

      <Dialog
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
      >
        <DialogContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>
                {editing === 'new' ? 'Save view' : 'Rename view'}
              </DialogTitle>
              <DialogDescription>
                {editing === 'new'
                  ? 'Keeps the kinds, filters, sort and layout All shows now, as a chip above the list.'
                  : 'The view keeps its kinds, filters, sort and layout.'}
              </DialogDescription>
            </DialogHeader>
            <Field label="Name">
              <Input
                value={name}
                maxLength={LIMITS.nameMax}
                autoComplete="off"
                autoFocus
                onChange={(e) => setName(e.target.value)}
                className="h-11 text-base desk:h-8 desk:text-xs"
              />
            </Field>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                Cancel
              </DialogClose>
              <Button
                type="submit"
                className="press"
                disabled={name.trim() === ''}
              >
                {editing === 'new' ? 'Save view' : 'Rename'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

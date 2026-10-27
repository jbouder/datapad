import {
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  DotsThreeIcon,
  StackMinusIcon,
  StackPlusIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const BUTTON =
  'press flex size-11 items-center justify-center outline-ring/50 transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 disabled:opacity-50 disabled:hover:bg-transparent desk:size-9';

/** A menu row: 44px to a finger. */
const ROW = 'min-h-11 desk:min-h-0';

/**
 * Undo, redo and the selection's menu (bring to front, send to back,
 * delete), in the board's top corner: top left on a phone (the zoom
 * controls hold the right), top right on desktop. The keys do the same:
 * ⌘Z, ⇧⌘Z, `]`, `[` and Delete.
 */
export function EditBar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  selected,
  onFront,
  onBack,
  onDelete,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** How many items are selected; the menu is there for one or more. */
  selected: number;
  onFront: () => void;
  onBack: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Edit"
      className="absolute top-2 left-2 z-10 flex items-center border bg-background/95 shadow-sm desk:top-3 desk:right-3 desk:left-auto"
    >
      <button
        type="button"
        className={BUTTON}
        onClick={onUndo}
        disabled={!canUndo}
        aria-label="Undo"
        aria-keyshortcuts="Control+Z Meta+Z"
        title="Undo (⌘Z)"
      >
        <ArrowUUpLeftIcon aria-hidden className="size-4" />
      </button>
      <button
        type="button"
        className={BUTTON}
        onClick={onRedo}
        disabled={!canRedo}
        aria-label="Redo"
        aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z"
        title="Redo (⇧⌘Z)"
      >
        <ArrowUUpRightIcon aria-hidden className="size-4" />
      </button>
      {selected > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className={BUTTON}
                aria-label="Selection"
                title="Selection"
              />
            }
          >
            <DotsThreeIcon aria-hidden className="size-5" weight="bold" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                {selected === 1 ? '1 item' : `${selected} items`}
              </DropdownMenuLabel>
              <DropdownMenuItem className={ROW} onClick={onFront}>
                <StackPlusIcon aria-hidden />
                Bring to front
                <DropdownMenuShortcut>]</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem className={ROW} onClick={onBack}>
                <StackMinusIcon aria-hidden />
                Send to back
                <DropdownMenuShortcut>[</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className={ROW}
              variant="destructive"
              onClick={onDelete}
            >
              <TrashIcon aria-hidden />
              Delete
              <DropdownMenuShortcut>Del</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

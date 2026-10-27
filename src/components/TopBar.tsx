import {
  ArrowClockwiseIcon,
  CheckSquareIcon,
  MagnifyingGlassIcon,
  NotePencilIcon,
  PlusIcon,
} from '@phosphor-icons/react';
import { useRef } from 'react';
import { paletteHint } from '@/components/Palette';
import { PreferencesMenu } from '@/components/PreferencesMenu';
import { SyncStatus } from '@/components/SyncStatus';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useHeadingScrolledPast } from '@/hooks/useHeadingScrolledPast';
import { linkProps } from '@/lib/router';

/**
 * The current title on the left once the page's own h1 has scrolled away
 * (with the brand on phones, where there is no rail), then the sync status
 * (a colored dot, with its word on desktop), Refresh on desktop (a full
 * reload: it picks up a new deploy, and unsent changes are already stored;
 * phones have it in the account menu, the bar has no room), Search (with
 * its shortcut on desktop), **+** (a menu: Add task and Write a note) and
 * the account menu (Help is there).
 */
export function TopBar({
  title,
  pageKey,
  email,
  onAddTask,
  onAddNote,
  onSearch,
}: {
  title: string;
  /** Changes when the page does, so the h1 is found again. */
  pageKey: string;
  email: string | null;
  onAddTask: () => void;
  onAddNote: () => void;
  onSearch: () => void;
}) {
  const hint = paletteHint();
  const bar = useRef<HTMLElement>(null);
  const showTitle = useHeadingScrolledPast(bar, pageKey);
  return (
    <header
      ref={bar}
      className="sticky top-0 z-30 border-b bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur supports-backdrop-filter:bg-background/70"
    >
      <div className="flex h-14 w-full items-center gap-2 px-4 sm:px-6">
        <a
          {...linkProps({ name: 'focus' })}
          className="press -ml-1.5 flex size-11 shrink-0 items-center justify-center outline-ring/50 focus-visible:outline-2 desk:hidden"
        >
          <DatapadMark className="size-6" />
          <span className="sr-only">Datapad, Focus</span>
        </a>
        {/* The page's h1 names it for assistive tech; this is the visual echo,
            shown only once that h1 has scrolled under the bar. */}
        <p
          aria-hidden
          data-shown={showTitle || undefined}
          className="min-w-0 flex-1 translate-y-1 truncate font-heading text-base font-semibold tracking-tight opacity-0 transition-[opacity,translate] duration-(--duration-base) ease-(--ease-standard) data-shown:translate-y-0 data-shown:opacity-100"
        >
          {title}
        </p>

        <div className="flex shrink-0 items-center gap-1">
          <SyncStatus className="desk:mr-1" />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="press hidden size-9 desk:mr-1 desk:inline-flex"
                  onClick={() => window.location.reload()}
                />
              }
            >
              <ArrowClockwiseIcon weight="bold" />
              <span className="sr-only">Refresh</span>
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
          <Button
            variant="outline"
            className="press size-11 p-0 text-muted-foreground sm:size-9 desk:mr-1 desk:h-9 desk:w-auto desk:gap-2 desk:px-2.5"
            aria-keyshortcuts="Meta+K Control+K /"
            onClick={onSearch}
          >
            <MagnifyingGlassIcon weight="bold" />
            <span className="sr-only desk:not-sr-only desk:text-xs">
              Search
            </span>
            <kbd
              aria-hidden
              className="hidden border px-1 font-sans text-[11px] desk:inline"
            >
              {hint}
            </kbd>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="press size-11 sm:size-9"
                  aria-label="Add"
                />
              }
            >
              <PlusIcon weight="bold" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem aria-keyshortcuts="N" onClick={onAddTask}>
                <CheckSquareIcon />
                Add task
                <DropdownMenuShortcut className="hidden desk:inline">
                  N
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem aria-keyshortcuts="Shift+N" onClick={onAddNote}>
                <NotePencilIcon />
                Write a note
                <DropdownMenuShortcut className="hidden desk:inline">
                  ⇧N
                </DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <PreferencesMenu email={email} />
        </div>
      </div>
    </header>
  );
}

export function DatapadMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect
        x="12"
        y="6"
        width="40"
        height="52"
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
      />
      <path
        d="M21 20h22M21 30h22M21 40h12"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
      />
      <rect x="38" y="38" width="6" height="6" fill="currentColor" />
    </svg>
  );
}

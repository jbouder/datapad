import { PlusIcon, QuestionIcon } from '@phosphor-icons/react';
import { PreferencesMenu } from '@/components/PreferencesMenu';
import { SyncStatus } from '@/components/SyncStatus';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { linkProps, type Route } from '@/lib/router';
import { cn } from '@/lib/utils';

/**
 * The current title on the left (with the brand on phones, where there is
 * no rail), then sync trouble on phones, **+** (Add task), Help and
 * Preferences.
 */
export function TopBar({
  route,
  title,
  email,
  onAddTask,
}: {
  route: Route;
  title: string;
  email: string | null;
  onAddTask: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur supports-backdrop-filter:bg-background/70">
      <div className="flex h-14 w-full items-center gap-2 px-4 sm:px-6">
        <a
          {...linkProps({ name: 'focus' })}
          className="press -ml-1.5 flex size-11 shrink-0 items-center justify-center outline-ring/50 focus-visible:outline-2 desk:hidden"
        >
          <DatapadMark className="size-6" />
          <span className="sr-only">Datapad, Focus</span>
        </a>
        {/* The page's h1 names it for assistive tech; this is the visual echo. */}
        <p
          aria-hidden
          className="min-w-0 flex-1 truncate font-heading text-base font-semibold tracking-tight"
        >
          {title}
        </p>

        <div className="flex shrink-0 items-center gap-1">
          <SyncStatus className="mr-1 desk:hidden" compact />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="press size-11 sm:size-9"
                  onClick={onAddTask}
                />
              }
            >
              <PlusIcon weight="bold" />
              <span className="sr-only">Add task</span>
            </TooltipTrigger>
            <TooltipContent>Add task</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                // A real link (role link), styled as an icon button.
                <a
                  {...linkProps({ name: 'help' })}
                  aria-current={route.name === 'help' ? 'page' : undefined}
                  className={cn(
                    buttonVariants({
                      variant: route.name === 'help' ? 'secondary' : 'ghost',
                      size: 'icon',
                    }),
                    'press size-11 sm:size-9',
                  )}
                />
              }
            >
              <QuestionIcon weight="bold" />
              <span className="sr-only">Help</span>
            </TooltipTrigger>
            <TooltipContent>Help</TooltipContent>
          </Tooltip>
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

import { QuestionIcon } from '@phosphor-icons/react';
import { PreferencesMenu } from '@/components/PreferencesMenu';
import { SyncStatus } from '@/components/SyncStatus';
import { buttonVariants } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { linkProps, type Route } from '@/lib/router';
import { cn } from '@/lib/utils';

/** Brand on the left, help and preferences on the right. */
export function TopBar({
  route,
  email,
}: {
  route: Route;
  email: string | null;
}) {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur supports-backdrop-filter:bg-background/70">
      <div className="flex h-14 w-full items-center gap-3 px-4 sm:px-6">
        <a
          {...linkProps({ name: 'focus' })}
          className="press flex min-h-11 items-center gap-2 font-heading text-base font-semibold tracking-tight outline-ring/50 focus-visible:outline-2"
        >
          <DatapadMark className="size-6" />
          <span>Datapad</span>
          <span className="sr-only">, Focus</span>
        </a>

        <div className="ml-auto flex items-center gap-1">
          <SyncStatus className="mr-2" />
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

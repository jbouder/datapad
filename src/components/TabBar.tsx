import { NAV, sectionOf } from '@/lib/nav';
import { linkProps, type Route } from '@/lib/router';
import { cn } from '@/lib/utils';

/**
 * The phone's navigation (< 820px): the five sections along the bottom,
 * one thumb away, above the home indicator. The rail replaces it on
 * desktop.
 */
export function TabBar({ route }: { route: Route }) {
  const section = sectionOf(route);
  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-backdrop-filter:bg-background/80 desk:hidden"
    >
      <ul className="grid h-(--tabbar-height) grid-cols-5">
        {NAV.filter((n) => !n.desktopOnly).map(
          ({ route: to, label, icon: Icon }) => {
            const current = section === to.name;
            return (
              <li key={to.name} className="flex">
                <a
                  {...linkProps(to)}
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    'press flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground outline-ring/50 focus-visible:outline-2 focus-visible:-outline-offset-2',
                    current && 'font-semibold text-foreground',
                  )}
                >
                  <Icon
                    weight={current ? 'fill' : 'regular'}
                    className="size-5"
                    aria-hidden
                  />
                  <span className="max-w-full truncate">{label}</span>
                </a>
              </li>
            );
          },
        )}
      </ul>
    </nav>
  );
}

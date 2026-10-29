import { sectionOf, useNav } from '@/lib/nav';
import { linkProps, type Route } from '@/lib/router';
import { cn } from '@/lib/utils';

/** Spelled out, so Tailwind sees every class. */
const COLUMNS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
  6: 'grid-cols-6',
};

/**
 * The phone's navigation (< 820px): the sections Settings → Navigation
 * shows and keeps on the phone, in its order, then the tools whose Phone
 * switch is on (#261; none by default), evenly along the bottom (one to
 * six columns; tools past six go to the account menu), one thumb away,
 * above the home indicator. The rail replaces it on desktop.
 */
export function TabBar({ route }: { route: Route }) {
  const section = sectionOf(route);
  const { phoneItems: items } = useNav();
  return (
    <nav
      aria-label="Sections"
      className="vt-tabbar fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-backdrop-filter:bg-background/80 desk:hidden"
    >
      <ul className={cn('grid h-(--tabbar-height)', COLUMNS[items.length])}>
        {items.map(({ route: to, label, icon: Icon }) => {
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
        })}
      </ul>
    </nav>
  );
}

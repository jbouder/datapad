import { usePlaces } from '@/hooks/usePlaces';
import { placeOf, ROOMS_TAB } from '@/lib/nav';
import { linkProps, type Route } from '@/lib/router';
import { cn } from '@/lib/utils';

/**
 * The phone's navigation (< 820px, #329): Today, Unfiled, Rooms and All,
 * in four columns along the bottom, one thumb away, above the home
 * indicator. Rooms opens the rail's rooms as a page (`/rooms`) and stays
 * current inside any room. Opaque, so its labels keep their contrast
 * over whatever scrolls under it. The rail replaces it on desktop.
 */
export function TabBar({ route }: { route: Route }) {
  const place = placeOf(route);
  const places = usePlaces();
  const tabs = places.flatMap((p) => (p.name === 'all' ? [ROOMS_TAB, p] : [p]));
  return (
    <nav
      aria-label="Sections"
      className="vt-tabbar fixed inset-x-0 bottom-0 z-30 border-t bg-background pb-[env(safe-area-inset-bottom)] desk:hidden"
    >
      <ul className="grid h-(--tabbar-height) grid-cols-4">
        {tabs.map(({ name, route: to, label, icon: Icon }) => {
          const current = place === name;
          return (
            <li key={name} className="flex">
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

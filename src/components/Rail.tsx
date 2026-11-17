import { RoomLists } from '@/components/RoomLists';
import { SpaceSwitcher } from '@/components/SpaceSwitcher';
import { SyncStatus } from '@/components/SyncStatus';
import { usePlaces } from '@/hooks/usePlaces';
import { useRooms } from '@/hooks/useRooms';
import { placeOf } from '@/lib/nav';
import { linkProps, type Route } from '@/lib/router';
import { cn } from '@/lib/utils';

/** A place's row: the rooms' look (`RoomLists`), `aria-current` on its page. */
const ROW =
  'press flex h-9 items-center gap-2.5 px-2 text-sm outline-ring/50 hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:-outline-offset-2';
const CURRENT =
  'bg-sidebar-accent font-semibold text-sidebar-accent-foreground';

/**
 * The desktop rail (≥ 820px, #329): the space switcher; Today, Scratch
 * (with its count) and All; then Rooms: the pinned rooms in your order,
 * or before anything is pinned the active projects, most recently changed
 * first, with their open counts; then the people who owe you something,
 * with counts, until they are pinned (unless Settings → Rooms leaves
 * them out); and the sync status at the foot. All opens on the kinds
 * Settings → All names.
 * The rooms come from `useRooms`, which the phone's Rooms page shares.
 * Hidden below 820px, where the tab bar takes over.
 */
export function Rail({ route }: { route: Route }) {
  const place = placeOf(route);
  const places = usePlaces();
  const rail = useRooms(route);

  return (
    <aside
      aria-label="Datapad"
      className="vt-rail sticky top-0 hidden h-dvh w-(--rail-width) shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground desk:flex"
    >
      <SpaceSwitcher />

      <nav
        aria-label="Sections"
        className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-4"
      >
        <ul className="flex flex-col">
          {places.map(({ name, route: to, label, icon: Icon }) => {
            const current = place === name;
            const count = name === 'scratch' ? (rail?.scratch ?? 0) : 0;
            return (
              <li key={name}>
                <a
                  {...linkProps(to)}
                  aria-current={current ? 'page' : undefined}
                  className={cn(ROW, current && CURRENT)}
                >
                  <Icon weight={current ? 'fill' : 'regular'} aria-hidden />
                  <span className="flex-1">{label}</span>
                  {count > 0 && (
                    <span className="count text-xs text-muted-foreground tabular-nums">
                      {count}
                      <span className="sr-only"> in Scratch</span>
                    </span>
                  )}
                </a>
              </li>
            );
          })}
        </ul>

        {rail && <RoomLists list={rail} look="rail" id="rail" />}
      </nav>

      <footer className="flex flex-col gap-2 border-t px-4 py-3">
        <SyncStatus />
      </footer>
    </aside>
  );
}

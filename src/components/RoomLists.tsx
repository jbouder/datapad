import type { RoomRow, RoomsList } from '@/hooks/useRooms';
import { linkProps } from '@/lib/router';
import { cn } from '@/lib/utils';

/** How each list draws its rows: the rail's compact look or the page's. */
const LOOKS = {
  rail: {
    section: '',
    heading: 'px-2 pb-1 text-xs font-medium text-muted-foreground',
    list: 'flex flex-col',
    row: 'press flex h-8 items-center gap-2.5 px-2 text-sm outline-ring/50 hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:-outline-offset-2',
    current: 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground',
  },
  page: {
    section: 'flex flex-col gap-2',
    heading: 'text-sm font-semibold',
    list: 'flex flex-col border-t',
    // 44px on touch: these are the phone's way into a room.
    row: 'press flex min-h-11 items-center gap-3 border-b px-1 text-sm outline-ring/50 hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2',
    current: 'bg-muted font-semibold',
  },
} as const;

type Look = keyof typeof LOOKS;

/**
 * The rooms and the people waiting on, as rows of links (`useRooms`):
 * the rail's Rooms and Waiting on, and the phone's Rooms page. `look`
 * picks the rail's compact rows or the page's 44px ones; `id` keeps the
 * headings' ids apart.
 */
export function RoomLists({
  list,
  look,
  id,
}: {
  list: RoomsList;
  look: Look;
  id: string;
}) {
  return (
    <>
      {list.rooms.length > 0 && (
        <Section
          id={`${id}-rooms`}
          title="Rooms"
          rows={list.rooms}
          look={look}
          unit="open"
          pinned={list.pinned}
        />
      )}
      {list.owed.length > 0 && (
        <Section
          id={`${id}-owed`}
          title="Waiting on"
          rows={list.owed}
          look={look}
          unit="waiting"
        />
      )}
    </>
  );
}

function Section({
  id,
  title,
  rows,
  look,
  unit,
  pinned,
}: {
  id: string;
  title: string;
  rows: RoomRow[];
  look: Look;
  unit: string;
  pinned?: boolean;
}) {
  const s = LOOKS[look];
  return (
    <section aria-labelledby={id} className={s.section || undefined}>
      <h2 id={id} className={s.heading}>
        {title}
      </h2>
      <ul className={s.list} data-pinned={pinned}>
        {rows.map((row) => (
          <li key={row.key}>
            <a
              {...linkProps(row.route, row.query)}
              aria-current={row.current ? 'page' : undefined}
              className={cn(s.row, row.current && s.current)}
            >
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              {row.count > 0 && (
                <span className="count text-xs text-muted-foreground tabular-nums">
                  {row.count}
                  <span className="sr-only"> {unit}</span>
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

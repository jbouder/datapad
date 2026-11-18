import { AddRoomMenu } from '@/components/AddRoomMenu';
import type { RoomRow, RoomsList } from '@/hooks/useRooms';
import { linkProps, useRoute } from '@/lib/router';
import { cn } from '@/lib/utils';

/** How each list draws its rows: the rail's compact look or the page's. */
const LOOKS = {
  rail: {
    section: '',
    header: 'flex items-center justify-between gap-2 pr-1 pb-1 pl-2',
    heading: 'text-xs font-medium text-muted-foreground',
    // Rooms' heading opens the Rooms page, and looks just like the heading.
    headingLink:
      'rounded-sm outline-ring/50 focus-visible:outline-2 focus-visible:outline-offset-2',
    add: '',
    list: 'flex flex-col',
    row: 'press flex h-8 items-center gap-2.5 px-2 text-sm outline-ring/50 hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:-outline-offset-2',
    current: 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground',
  },
  page: {
    section: 'flex flex-col gap-2',
    header: 'flex items-center justify-between gap-2',
    heading: 'text-sm font-semibold',
    // The page is the Rooms page: no link to itself.
    headingLink: '',
    // 44px on touch, like the rows.
    add: 'size-11 desk:size-8',
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
 * headings' ids apart. Rooms always shows, empty or not, for its `+`
 * (`AddRoomMenu`). In the rail, the Rooms heading is a link to the Rooms
 * page (`/rooms`).
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
      <Section
        id={`${id}-rooms`}
        title="Rooms"
        rows={list.rooms}
        look={look}
        unit="open"
        pinned={list.pinned}
        add
        link={look === 'rail'}
      />
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
  add,
  link,
}: {
  id: string;
  title: string;
  rows: RoomRow[];
  look: Look;
  unit: string;
  pinned?: boolean;
  /** Show the `+` that adds a room. */
  add?: boolean;
  /** The heading links to the Rooms page. */
  link?: boolean;
}) {
  const s = LOOKS[look];
  const onRooms = useRoute().name === 'rooms';
  return (
    <section aria-labelledby={id} className={s.section || undefined}>
      <div className={s.header}>
        <h2 id={id} className={s.heading}>
          {link ? (
            <a
              {...linkProps({ name: 'rooms' })}
              aria-current={onRooms ? 'page' : undefined}
              className={s.headingLink}
            >
              {title}
            </a>
          ) : (
            title
          )}
        </h2>
        {add && <AddRoomMenu className={s.add || undefined} />}
      </div>
      {rows.length > 0 && (
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
      )}
    </section>
  );
}

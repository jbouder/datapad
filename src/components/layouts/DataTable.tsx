import { CaretDownIcon, CaretUpIcon } from '@phosphor-icons/react';
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useRef,
  useState,
} from 'react';
import { cn } from '@/lib/utils';

export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Present when the column can sort. */
  sortable?: boolean;
  className?: string;
}

export interface RowGroup<T> {
  id: string;
  label: string;
  rows: T[];
}

export interface TableSort {
  column: string;
  dir: 'asc' | 'desc';
}

export interface Selection {
  selected: ReadonlySet<string>;
  /** Shift extends from the last toggled row. */
  toggle: (id: string, range: boolean) => void;
  toggleGroup: (ids: string[]) => void;
  /** ⌘/Ctrl+A within a group: select every row in it. */
  selectGroup?: (ids: string[]) => void;
}

/**
 * A dense table for desktop: sticky header, sortable columns announcing
 * their direction, group header rows, optional row selection, and a
 * roving focus (↑ ↓ move between rows, Enter opens, Space selects). Below
 * 820px it renders `mobileRow` for each item instead: tables collapse to
 * rows on phones. Rows carry `data-layout-id` for layout transitions.
 */
export function DataTable<T>({
  label,
  columns,
  groups,
  getId,
  sort,
  onSort,
  selection,
  onOpen,
  mobileRow,
  rowLabel,
}: {
  label: string;
  columns: Column<T>[];
  /** One group with an empty label renders without a header row. */
  groups: RowGroup<T>[];
  getId: (row: T) => string;
  sort?: TableSort;
  onSort?: (column: string) => void;
  selection?: Selection;
  onOpen?: (row: T) => void;
  mobileRow: (row: T) => ReactNode;
  /** The row's name, for the select checkbox ("Select “…”"). */
  rowLabel: (row: T) => string;
}) {
  const body = useRef<HTMLTableElement>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const flat = groups.flatMap((g) => g.rows);
  const current = focusId ?? (flat[0] ? getId(flat[0]) : null);

  const focusRow = useCallback((id: string) => {
    setFocusId(id);
    body.current
      ?.querySelector<HTMLElement>(`tr[data-row-id="${CSS.escape(id)}"]`)
      ?.focus();
  }, []);

  const onRowKey = (
    event: KeyboardEvent<HTMLTableRowElement>,
    row: T,
    groupIds: string[],
  ) => {
    if (
      selection?.selectGroup &&
      (event.metaKey || event.ctrlKey) &&
      event.key.toLowerCase() === 'a'
    ) {
      event.preventDefault();
      selection.selectGroup(groupIds);
      return;
    }
    if (event.target !== event.currentTarget) return;
    const i = flat.findIndex((r) => getId(r) === getId(row));
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = flat[i + (event.key === 'ArrowDown' ? 1 : -1)];
      if (next) focusRow(getId(next));
    } else if (event.key === 'Enter' && onOpen) {
      event.preventDefault();
      onOpen(row);
    } else if (event.key === ' ' && selection) {
      event.preventDefault();
      selection.toggle(getId(row), event.shiftKey);
    }
  };

  const span = columns.length + (selection ? 1 : 0);

  return (
    <>
      <div className="vt-list hidden overflow-x-clip desk:block">
        <table
          ref={body}
          aria-label={label}
          className="w-full border-collapse text-sm"
        >
          {/* Sticks under the top bar: the wrapper clips, it does not scroll. */}
          <thead className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-10 bg-background">
            <tr className="border-b">
              {selection && (
                <th scope="col" className="w-9">
                  <span className="sr-only">Selected</span>
                </th>
              )}
              {columns.map((col) => {
                const active = sort?.column === col.id;
                return (
                  <th
                    key={col.id}
                    scope="col"
                    aria-sort={
                      active
                        ? sort?.dir === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : col.sortable
                          ? 'none'
                          : undefined
                    }
                    className={cn(
                      'h-9 px-2 text-left text-xs font-medium text-muted-foreground',
                      col.className,
                    )}
                  >
                    {col.sortable && onSort ? (
                      <button
                        type="button"
                        onClick={() => onSort(col.id)}
                        className="press inline-flex items-center gap-1 outline-ring/50 hover:text-foreground focus-visible:outline-2"
                      >
                        {col.header}
                        {active &&
                          (sort?.dir === 'asc' ? (
                            <CaretUpIcon aria-hidden weight="bold" />
                          ) : (
                            <CaretDownIcon aria-hidden weight="bold" />
                          ))}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          {groups.map((group) => {
            const ids = group.rows.map(getId);
            const all =
              selection &&
              ids.length > 0 &&
              ids.every((id) => selection.selected.has(id));
            return (
              <tbody key={group.id} data-group={group.id}>
                {group.label && (
                  <tr className="border-b bg-muted/40">
                    {selection && (
                      <td className="w-9 text-center">
                        <input
                          type="checkbox"
                          aria-label={`Select all in ${group.label}`}
                          checked={Boolean(all)}
                          onChange={() => selection.toggleGroup(ids)}
                          className="size-4 accent-foreground"
                        />
                      </td>
                    )}
                    <th
                      scope="rowgroup"
                      colSpan={span - (selection ? 1 : 0)}
                      className="h-8 px-2 text-left"
                    >
                      <h3 className="inline font-heading text-xs font-semibold">
                        {group.label}
                      </h3>
                      <span className="count ml-2 text-xs font-normal text-muted-foreground tabular-nums">
                        {group.rows.length}
                      </span>
                    </th>
                  </tr>
                )}
                {group.rows.map((row) => {
                  const id = getId(row);
                  const selected = selection?.selected.has(id) ?? false;
                  return (
                    <tr
                      key={id}
                      data-row-id={id}
                      data-layout-id={id}
                      data-flip-id={id}
                      tabIndex={id === current ? 0 : -1}
                      aria-selected={selection ? selected : undefined}
                      onFocus={(e) => {
                        if (e.target === e.currentTarget) setFocusId(id);
                      }}
                      onKeyDown={(e) => onRowKey(e, row, ids)}
                      className={cn(
                        'h-9 border-b outline-ring/50 hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2',
                        selected && 'bg-accent/60',
                      )}
                    >
                      {selection && (
                        <td className="w-9 text-center">
                          <input
                            type="checkbox"
                            aria-label={`Select “${rowLabel(row)}”`}
                            checked={selected}
                            // Not preventDefault: on a controlled checkbox the
                            // browser would undo the tick after React set it.
                            onClick={(e) => selection.toggle(id, e.shiftKey)}
                            onChange={() => {}}
                            className="size-4 accent-foreground"
                          />
                        </td>
                      )}
                      {columns.map((col) => (
                        <td key={col.id} className={cn('px-2', col.className)}>
                          {col.cell(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>

      <div className="vt-list flex flex-col gap-4 desk:hidden">
        {groups.map((group) => (
          <section
            key={group.id}
            aria-label={group.label || label}
            className="flex flex-col"
          >
            {group.label && (
              <h3 className="flex items-center gap-2 pb-1 font-heading text-sm font-semibold">
                {group.label}
                <span className="count font-sans text-xs font-normal text-muted-foreground">
                  {group.rows.length}
                </span>
              </h3>
            )}
            <ul className="flex flex-col border-t">
              {group.rows.map((row) => (
                <li key={getId(row)} data-layout-id={getId(row)}>
                  {mobileRow(row)}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

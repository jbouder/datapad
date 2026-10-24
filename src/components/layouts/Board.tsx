import { ArrowsLeftRightIcon } from '@phosphor-icons/react';
import { type ReactNode, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface BoardColumn<T> {
  id: string;
  title: string;
  items: T[];
  /** Shown in an empty column, under the drop target. */
  empty?: string;
}

/**
 * Columns side by side with their counts. Cards drag between columns on
 * desktop; on every device each card's "Move to…" menu does the same, so
 * the keyboard and touch are not left out. Scrolls sideways inside its own
 * box (snapping column by column on phones), never the page.
 */
export function Board<T>({
  label,
  columns,
  getId,
  itemLabel,
  renderCard,
  onMove,
}: {
  label: string;
  columns: BoardColumn<T>[];
  getId: (item: T) => string;
  itemLabel: (item: T) => string;
  renderCard: (item: T) => ReactNode;
  onMove: (item: T, from: string, to: string) => void;
}) {
  const [drag, setDrag] = useState<{ id: string; from: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const find = (id: string) => {
    for (const c of columns) {
      const item = c.items.find((i) => getId(i) === id);
      if (item) return item;
    }
    return undefined;
  };

  return (
    <section
      aria-label={label}
      className="vt-list -mx-4 snap-x snap-mandatory overflow-x-auto px-4 pb-2 desk:mx-0 desk:snap-none desk:px-0"
    >
      <div className="flex min-w-max gap-3">
        {columns.map((column) => (
          <section
            key={column.id}
            aria-label={column.title}
            data-column={column.id}
            onDragOver={(e) => {
              if (!drag) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setOver(column.id);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                setOver((o) => (o === column.id ? null : o));
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              const item = drag ? find(drag.id) : undefined;
              if (item && drag && drag.from !== column.id) {
                onMove(item, drag.from, column.id);
              }
              setDrag(null);
              setOver(null);
            }}
            className={cn(
              'flex w-[min(85vw,18rem)] shrink-0 snap-start flex-col gap-2 border bg-muted/30 p-2',
              over === column.id &&
                drag?.from !== column.id &&
                'border-ring bg-accent/40',
            )}
          >
            <h3 className="flex items-center gap-2 px-1 font-heading text-sm font-semibold">
              <span className="min-w-0 flex-1 truncate">{column.title}</span>
              <span className="count font-sans text-xs font-normal text-muted-foreground tabular-nums">
                {column.items.length}
              </span>
            </h3>
            <ul className="flex min-h-16 flex-col gap-2">
              {column.items.map((item) => {
                const id = getId(item);
                return (
                  <li
                    key={id}
                    data-layout-id={id}
                    data-flip-id={id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', id);
                      setDrag({ id, from: column.id });
                    }}
                    onDragEnd={() => {
                      setDrag(null);
                      setOver(null);
                    }}
                    className={cn(
                      'group/card relative cursor-grab border bg-card active:cursor-grabbing',
                      drag?.id === id && 'opacity-50',
                    )}
                  >
                    {renderCard(item)}
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label={`Move “${itemLabel(item)}” to…`}
                        className="press absolute top-1 right-1 flex size-11 items-center justify-center text-muted-foreground outline-ring/50 hover:text-foreground focus-visible:outline-2 desk:size-7"
                      >
                        <ArrowsLeftRightIcon aria-hidden />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuGroup>
                          <DropdownMenuLabel>Move to</DropdownMenuLabel>
                          {columns
                            .filter((c) => c.id !== column.id)
                            .map((c) => (
                              <DropdownMenuItem
                                key={c.id}
                                onClick={() => onMove(item, column.id, c.id)}
                              >
                                {c.title}
                              </DropdownMenuItem>
                            ))}
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                );
              })}
            </ul>
            {column.items.length === 0 && (
              <p className="px-1 pb-2 text-xs text-muted-foreground">
                {column.empty ?? 'Nothing here. Drag a card in.'}
              </p>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}

import {
  ArrowDownIcon,
  ArrowLineUpIcon,
  ArrowUpIcon,
  CaretRightIcon,
  CheckIcon,
  DotsSixVerticalIcon,
  DotsThreeIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { useId, useRef, useState } from 'react';
import { LIMITS } from '#shared/limits';
import { moveOpenItem } from '#shared/lists';
import { restoredOrder } from '#shared/meetings';
import type { Op } from '#shared/protocol';
import type { List, ListItem } from '#shared/types';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDatapad } from '@/hooks/useDatapad';
import { useFlip } from '@/hooks/useFlip';
import { dropIndex } from '@/lib/reorder';
import { cn } from '@/lib/utils';
import { useMotion } from '@/providers/MotionProvider';
import { useToast } from '@/providers/ToastProvider';

type BatchOps = Extract<Op, { type: 'batch' }>['ops'];

const ICON_BUTTON =
  'press flex size-11 shrink-0 items-center justify-center text-muted-foreground outline-ring/50 hover:bg-accent hover:text-foreground focus-visible:outline-2 data-popup-open:bg-accent desk:size-8';

const INLINE_INPUT =
  'h-11 w-full min-w-0 border bg-transparent px-2 text-base outline-ring/50 focus-visible:outline-2 desk:h-8 desk:text-sm';

/**
 * A list's items (#299), on its page: the open ones first, in their
 * order, then the done ones struck through under Done (n), collapsed.
 * Each has a checkbox, its text (click or Enter to edit in place; Enter
 * saves, Escape cancels) and a menu: Edit, Move up, Move down, Move to
 * top and Delete (Undo in the toast). Drag the handle to reorder with a
 * mouse; Alt+↑ / Alt+↓ on a row and the menu are the keyboard and touch
 * ways. Add an item opens a field at the end that stays open for the next
 * after Enter; Escape closes it.
 */
export function ListItems({ list }: { list: List }) {
  const { state, actions } = useDatapad();
  const { show } = useToast();
  const { active } = useMotion();
  const headingId = useId();
  const doneId = useId();
  const openList = useRef<HTMLUListElement>(null);
  useFlip(openList, active);
  const addRef = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [armedId, setArmedId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const latest = useRef(state);
  latest.current = state;

  const open = list.items.filter((i) => !i.done);
  const done = list.items.filter((i) => i.done);

  // What was there at first stays still; anything added later enters.
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null)
    seen.current = new Set(list.items.map((i) => i.id));

  const startAdding = () => {
    if (adding) addRef.current?.focus();
    else setAdding(true);
  };
  const stopAdding = () => {
    setAdding(false);
    setDraft('');
    addButton.current?.focus();
  };
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    if (actions.addListItem({ listId: list.id, text }) === null) return;
    setDraft('');
    setAnnouncement(`Added “${text}”`);
  };

  const move = (item: ListItem, to: number) => {
    const ids = moveOpenItem(list, item.id, to);
    if (!ids) return;
    if (actions.reorderListItems({ listId: list.id, ids })) {
      const at = Math.max(0, Math.min(to, open.length - 1));
      setAnnouncement(
        `Moved “${item.text}” to position ${at + 1} of ${open.length}`,
      );
    }
  };

  /** After a row goes: focus its neighbor, or Add an item. */
  const refocus = (index: number, rows: ListItem[]) => {
    const next = rows[index + 1] ?? rows[index - 1];
    requestAnimationFrame(() => {
      const target = next
        ? document.querySelector<HTMLElement>(
            `[data-item-id="${next.id}"] [data-item-text]`,
          )
        : null;
      (target ?? addButton.current)?.focus();
    });
  };

  const remove = (item: ListItem, index: number, rows: ListItem[]) => {
    const before = list.items.map((i) => i.id);
    if (!actions.deleteListItem({ listId: list.id, id: item.id })) return;
    refocus(index, rows);
    show(`Deleted “${item.text}”`, () => {
      const now = latest.current?.lists[list.id];
      if (!now) return;
      const current = now.items.map((i) => i.id);
      const ops: BatchOps = [
        { type: 'addListItem', listId: list.id, id: item.id, text: item.text },
      ];
      if (item.done) {
        ops.push({
          type: 'setListItemDone',
          listId: list.id,
          id: item.id,
          done: true,
        });
      }
      const order = restoredOrder(before, current, item.id);
      if (order[order.length - 1] !== item.id) {
        ops.push({ type: 'reorderListItems', listId: list.id, ids: order });
      }
      actions.batch({ ops });
    });
  };

  const drop = () => {
    if (!dragId || overIndex === null) return;
    const from = open.findIndex((i) => i.id === dragId);
    const item = open[from];
    const to = from < 0 ? null : dropIndex(from, overIndex);
    if (item && to !== null) move(item, to);
  };

  const row = (item: ListItem, index: number, rows: ListItem[]) => (
    <ItemRow
      list={list}
      item={item}
      index={index}
      count={rows.length}
      onArm={() => setArmedId(item.id)}
      onMove={(to) => move(item, to)}
      onRemove={() => remove(item, index, rows)}
    />
  );

  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-baseline gap-2">
          <h2 id={headingId} className="text-xs font-medium">
            Items
            <span className="sr-only"> on “{list.title}”</span>
          </h2>
          {open.length > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {open.length} open
            </span>
          )}
        </span>
        <Button
          ref={addButton}
          type="button"
          variant="outline"
          className="press h-11 desk:h-7"
          aria-expanded={adding}
          onClick={startAdding}
        >
          <PlusIcon />
          Add an item
        </Button>
      </div>

      {list.items.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">No items yet</p>
      )}
      {list.items.length > 0 && open.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">Every item is done</p>
      )}

      {open.length > 0 && (
        <ul
          ref={openList}
          aria-labelledby={headingId}
          className={cn(
            'flex min-w-0 flex-col',
            dragId && overIndex === open.length && 'task-drop-end',
          )}
          onDragOver={
            dragId
              ? (event) => {
                  event.preventDefault();
                  if (event.target === event.currentTarget) {
                    setOverIndex(open.length);
                  }
                }
              : undefined
          }
          onDrop={(event) => {
            event.preventDefault();
            drop();
          }}
        >
          {open.map((item, index) => (
            <li
              key={item.id}
              data-flip-id={item.id}
              data-item-id={item.id}
              draggable={armedId === item.id}
              data-drop-before={
                dragId && overIndex === index && dragId !== item.id
                  ? ''
                  : undefined
              }
              className={cn(
                'task-drop-target flex min-w-0 items-start border-l',
                !seen.current?.has(item.id) && 'enter',
                dragId === item.id && 'opacity-50',
              )}
              onKeyDown={(event) => {
                if (!event.altKey) return;
                if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                  event.preventDefault();
                  move(item, index + (event.key === 'ArrowUp' ? -1 : 1));
                }
              }}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', item.id);
                setDragId(item.id);
              }}
              onDragOver={
                dragId
                  ? (event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      setOverIndex(index);
                    }
                  : undefined
              }
              onDragEnd={() => {
                setDragId(null);
                setArmedId(null);
                setOverIndex(null);
              }}
            >
              {row(item, index, open)}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <input
          ref={addRef}
          value={draft}
          maxLength={LIMITS.titleMax}
          autoComplete="off"
          enterKeyHint="enter"
          placeholder="Add an item"
          aria-label={`Add an item to “${list.title}”`}
          // biome-ignore lint/a11y/noAutofocus: opened by Add an item.
          autoFocus
          className={cn(INLINE_INPUT, 'enter mt-1 border-dashed desk:max-w-md')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              add();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              stopAdding();
            }
          }}
        />
      )}

      {done.length > 0 && (
        <div className="flex min-w-0 flex-col pt-2">
          <button
            type="button"
            aria-expanded={showDone}
            aria-controls={doneId}
            onClick={() => setShowDone((v) => !v)}
            className="press flex min-h-11 items-center gap-1.5 self-start px-1 text-xs font-medium text-muted-foreground outline-ring/50 hover:text-foreground focus-visible:outline-2 desk:min-h-8"
          >
            <CaretRightIcon
              aria-hidden
              weight="bold"
              className={cn(
                'size-3.5 transition-transform duration-(--duration-fast)',
                showDone && 'rotate-90',
              )}
            />
            Done <span className="tabular-nums">({done.length})</span>
          </button>
          {showDone && (
            <ul
              id={doneId}
              aria-label={`Done on “${list.title}”`}
              className="flex min-w-0 flex-col"
            >
              {done.map((item, index) => (
                <li
                  key={item.id}
                  data-item-id={item.id}
                  className="flex min-w-0 items-start border-l"
                >
                  {row(item, index, done)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}

/**
 * One item: its handle (open ones, desktop), checkbox, text (a button
 * that opens the field) and menu.
 */
function ItemRow({
  list,
  item,
  index,
  count,
  onArm,
  onMove,
  onRemove,
}: {
  list: List;
  item: ListItem;
  /** Its place among the open ones, or among the done ones. */
  index: number;
  count: number;
  onArm: () => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const { actions } = useDatapad();
  const [editing, setEditing] = useState(false);
  const textButton = useRef<HTMLButtonElement>(null);
  /**
   * Edit or Delete was picked in the menu: it leaves focus to the field,
   * or to the row's neighbor, rather than to its button.
   */
  const noReturn = useRef(false);
  /** Enter or Escape closed the field: its blur, as it goes, is not a save. */
  const closed = useRef(false);

  /** Close the field, saving `value` (null: Escape, keep what was there). */
  const finish = (value: string | null, keyboard: boolean) => {
    if (closed.current) return;
    closed.current = keyboard;
    setEditing(false);
    if (keyboard) {
      requestAnimationFrame(() => {
        closed.current = false;
        textButton.current?.focus();
      });
    }
    if (value === null) return;
    const text = value.trim();
    if (!text || text === item.text) return;
    actions.editListItem({ listId: list.id, id: item.id, text });
  };

  return (
    <div className="flex min-w-0 flex-1 items-start text-sm">
      {!item.done && (
        <span
          aria-hidden
          title="Drag to reorder"
          onPointerDown={(event) => {
            if (event.pointerType === 'mouse') onArm();
          }}
          className="hidden h-8 w-5 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground active:cursor-grabbing desk:flex hover-none:hidden"
        >
          <DotsSixVerticalIcon weight="bold" />
        </span>
      )}
      <label
        className={cn(
          'press group/check flex size-11 shrink-0 cursor-pointer items-center justify-center has-focus-visible:outline-2 has-focus-visible:-outline-offset-4 has-focus-visible:outline-ring desk:size-8',
          item.done && 'desk:ml-5',
        )}
      >
        <input
          type="checkbox"
          checked={item.done}
          onChange={(e) =>
            actions.setListItemDone({
              listId: list.id,
              id: item.id,
              done: e.target.checked,
            })
          }
          aria-label={`Done: “${item.text}”`}
          className="sr-only"
        />
        <span
          aria-hidden
          className={cn(
            'task-check flex size-4 items-center justify-center border-[1.5px] border-muted-foreground/70 group-hover/check:border-foreground',
            item.done && 'is-done border-ok bg-ok text-ok-foreground',
          )}
        >
          <CheckIcon weight="bold" className="task-check-mark size-3" />
        </span>
      </label>
      <div className="flex min-w-0 flex-1 flex-col py-0.5">
        {editing ? (
          <input
            // biome-ignore lint/a11y/noAutofocus: opened by a click on the text or Edit.
            autoFocus
            defaultValue={item.text}
            maxLength={LIMITS.titleMax}
            autoComplete="off"
            enterKeyHint="done"
            aria-label={`Edit “${item.text}”`}
            className={INLINE_INPUT}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                finish(e.currentTarget.value, true);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                finish(null, true);
              }
            }}
            onBlur={(e) => finish(e.currentTarget.value, false)}
          />
        ) : (
          <button
            type="button"
            ref={textButton}
            data-item-text
            onClick={() => setEditing(true)}
            className={cn(
              'flex min-h-11 min-w-0 items-center text-left break-words outline-ring/50 focus-visible:outline-2 desk:min-h-7',
              item.done && 'text-muted-foreground line-through',
            )}
            aria-label={`${item.text}, edit`}
          >
            <span className="min-w-0">{item.text}</span>
          </button>
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={ICON_BUTTON}
          aria-label={`More for “${item.text}”`}
        >
          <DotsThreeIcon weight="bold" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-48"
          finalFocus={() => {
            const elsewhere = noReturn.current;
            noReturn.current = false;
            return !elsewhere;
          }}
        >
          <DropdownMenuItem
            className="min-h-11 desk:min-h-0"
            onClick={() => {
              noReturn.current = true;
              setEditing(true);
            }}
          >
            <PencilSimpleIcon />
            Edit
          </DropdownMenuItem>
          {!item.done && count > 1 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="min-h-11 desk:min-h-0"
                disabled={index === 0}
                onClick={() => onMove(index - 1)}
              >
                <ArrowUpIcon />
                Move up
              </DropdownMenuItem>
              <DropdownMenuItem
                className="min-h-11 desk:min-h-0"
                disabled={index === count - 1}
                onClick={() => onMove(index + 1)}
              >
                <ArrowDownIcon />
                Move down
              </DropdownMenuItem>
              <DropdownMenuItem
                className="min-h-11 desk:min-h-0"
                disabled={index === 0}
                onClick={() => onMove(0)}
              >
                <ArrowLineUpIcon />
                Move to top
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="min-h-11 desk:min-h-0"
            variant="destructive"
            onClick={() => {
              noReturn.current = true;
              onRemove();
            }}
          >
            <TrashIcon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

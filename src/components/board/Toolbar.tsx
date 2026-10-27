import {
  CursorIcon,
  type Icon,
  NoteBlankIcon,
  TextTIcon,
} from '@phosphor-icons/react';
import { type KeyboardEvent, useRef, useState } from 'react';
import { BOARD_COLORS, type BoardColor } from '#shared/types';
import { COLOR_LABELS } from '@/components/board/items';
import { cn } from '@/lib/utils';

/** What a pointer on the board does. #140 adds rect, arrow, ink, eraser. */
export const TOOLS = ['select', 'sticky', 'text'] as const;
export type Tool = (typeof TOOLS)[number];

export const TOOL_INFO: Record<
  Tool,
  { label: string; key: string; icon: Icon }
> = {
  select: { label: 'Select', key: 'V', icon: CursorIcon },
  sticky: { label: 'Sticky note', key: 'S', icon: NoteBlankIcon },
  text: { label: 'Text', key: 'T', icon: TextTIcon },
};

const BUTTON =
  'press flex size-11 shrink-0 items-center justify-center outline-ring/50 transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 aria-pressed:bg-primary aria-pressed:text-primary-foreground';

/**
 * The tools and the color: a toolbar (one tab stop; the arrow keys move
 * between its buttons) along the bottom on a phone, down the left on
 * desktop. Every button is a 44px target.
 */
export function Toolbar({
  tool,
  onTool,
  color,
  onColor,
}: {
  tool: Tool;
  onTool: (tool: Tool) => void;
  color: BoardColor;
  onColor: (color: BoardColor) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /** The button holding the tab stop, once the arrows have moved it. */
  const [stop, setStop] = useState<number | null>(null);
  const tabStop = stop ?? TOOLS.indexOf(tool);

  // Roving tabindex: the pressed tool holds the tab stop.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [
      ...(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? []),
    ];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    let next = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = at + 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      next = at - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    const index = (next + buttons.length) % buttons.length;
    setStop(index);
    buttons[index]?.focus();
  };

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Whiteboard tools"
      onKeyDown={onKeyDown}
      className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center border bg-background/95 shadow-sm desk:top-1/2 desk:bottom-auto desk:left-3 desk:-translate-x-0 desk:-translate-y-1/2 desk:flex-col"
    >
      {TOOLS.map((t, i) => {
        const { label, key, icon: ToolIcon } = TOOL_INFO[t];
        return (
          <button
            key={t}
            type="button"
            tabIndex={tabStop === i ? 0 : -1}
            aria-pressed={tool === t}
            aria-keyshortcuts={key}
            aria-label={label}
            title={`${label} (${key})`}
            onClick={() => onTool(t)}
            className={BUTTON}
          >
            <ToolIcon className="size-5" aria-hidden />
          </button>
        );
      })}
      <span
        aria-hidden
        className="mx-0.5 h-6 w-px bg-border desk:mx-0 desk:my-0.5 desk:h-px desk:w-6"
      />
      {BOARD_COLORS.map((c, i) => (
        <button
          key={c}
          type="button"
          tabIndex={tabStop === TOOLS.length + i ? 0 : -1}
          aria-pressed={color === c}
          aria-keyshortcuts={String(i + 1)}
          aria-label={`${COLOR_LABELS[c]} color`}
          title={`${COLOR_LABELS[c]} (${i + 1})`}
          data-color={c}
          onClick={() => onColor(c)}
          className={cn(
            BUTTON,
            'board-swatch aria-pressed:bg-muted aria-pressed:text-foreground',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'board-swatch-dot size-5 rounded-full transition-transform duration-(--duration-fast) ease-(--ease-standard)',
              color === c && 'scale-125',
            )}
          />
        </button>
      ))}
    </div>
  );
}

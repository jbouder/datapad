import { ArrowDownIcon, ArrowUpIcon } from '@phosphor-icons/react';
import { useId, useLayoutEffect, useRef } from 'react';
import {
  hiddenSections,
  moveSection,
  type PageSection,
  sectionOrder,
  toggleSection,
} from '#shared/pages';
import type { PagePrefsPatch } from '#shared/protocol';
import type { PagePrefs } from '#shared/types';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useFlip } from '@/hooks/useFlip';
import { useMotion } from '@/providers/MotionProvider';

const ICON_BUTTON = 'press size-11 desk:size-8';
/** A switch's cell: 44px on touch. */
const CELL = 'flex size-11 shrink-0 items-center justify-center desk:size-9';

/**
 * A page's sections in Settings (#310, #343): each with a Show switch
 * and Move up / Move down, 44px on touch, in the order the page shows
 * them; with `fixedOrder`, in the page's own order and without the moves.
 * At least one stays shown. Each change is a `setPagePrefs` patch
 * (`toggleSection`, `moveSection`). `label` is the list's accessible
 * name; `noun` what the hint calls one ("lane").
 */
export function SectionsEditor({
  label,
  noun = 'section',
  sections,
  prefs,
  fixedOrder = false,
  onChange,
}: {
  label: string;
  noun?: string;
  sections: readonly PageSection[];
  prefs: Pick<PagePrefs, 'hidden' | 'order'>;
  fixedOrder?: boolean;
  onChange: (patch: PagePrefsPatch) => void;
}) {
  const id = useId();
  const { active } = useMotion();
  const keys = sections.map((s) => s.key);
  const order = fixedOrder ? keys : sectionOrder(keys, prefs);
  const hidden = hiddenSections(keys, prefs);
  const shownCount = order.length - hidden.size;
  const labelOf = (key: string) =>
    sections.find((s) => s.key === key)?.label ?? key;

  const list = useRef<HTMLUListElement>(null);
  useFlip(list, active);

  // A move re-renders the rows: keep focus on the button pressed, or its
  // neighbor once that one is disabled at the end of the list.
  const refocus = useRef<{ key: string; by: -1 | 1 } | null>(null);
  useLayoutEffect(() => {
    const want = refocus.current;
    if (!want) return;
    refocus.current = null;
    const button = (by: number) =>
      list.current?.querySelector<HTMLButtonElement>(
        `[data-move="${want.key}:${by}"]`,
      );
    const pressed = button(want.by);
    (pressed && !pressed.disabled ? pressed : button(-want.by))?.focus();
  });

  const move = (key: string, by: -1 | 1) => {
    const patch = moveSection(keys, prefs, key, by);
    if (!patch) return;
    refocus.current = { key, by };
    onChange(patch);
  };
  const show = (key: string, on: boolean) => {
    const patch = toggleSection(keys, prefs, key, on);
    if (patch) onChange(patch);
  };

  const hint = `${id}-last`;
  return (
    <div className="flex flex-col gap-2">
      <ul ref={list} aria-label={label} className="flex flex-col border-t">
        {order.map((key, i) => {
          const name = labelOf(key);
          const shown = !hidden.has(key);
          const lastShown = shown && shownCount <= 1;
          const switchId = `${id}-${key}`;
          return (
            <li
              key={key}
              data-flip-id={key}
              data-section-row={key}
              className="row flex items-center gap-1 border-b bg-background text-sm"
            >
              <label
                htmlFor={switchId}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 desk:min-h-9"
              >
                <span
                  className={
                    shown ? 'font-medium' : 'font-medium text-muted-foreground'
                  }
                >
                  {name}
                </span>
                {!shown && (
                  <span className="text-xs text-muted-foreground">Hidden</span>
                )}
              </label>
              <span className={CELL}>
                <Switch
                  id={switchId}
                  aria-label={`Show ${name}`}
                  checked={shown}
                  disabled={lastShown}
                  aria-describedby={lastShown ? hint : undefined}
                  onCheckedChange={(on) => show(key, on)}
                />
              </span>
              {!fixedOrder && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={ICON_BUTTON}
                    title="Move up"
                    data-move={`${key}:-1`}
                    disabled={i === 0}
                    onClick={() => move(key, -1)}
                  >
                    <ArrowUpIcon />
                    <span className="sr-only">Move {name} up</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={ICON_BUTTON}
                    title="Move down"
                    data-move={`${key}:1`}
                    disabled={i === order.length - 1}
                    onClick={() => move(key, 1)}
                  >
                    <ArrowDownIcon />
                    <span className="sr-only">Move {name} down</span>
                  </Button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <p id={hint} className="text-xs text-muted-foreground">
        At least one {noun} stays shown.
      </p>
    </div>
  );
}

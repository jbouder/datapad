import { ArrowDownIcon, ArrowUpIcon, TrashIcon } from '@phosphor-icons/react';
import { useLayoutEffect, useRef } from 'react';
import { KIND_LABELS, removeView, renameView } from '#shared/all';
import { LIMITS } from '#shared/limits';
import {
  ALL_KINDS_SETTING,
  allHome,
  allHomeValue,
  DEFAULT_ALL_KINDS,
  patchOf,
} from '#shared/pages';
import { savedViews } from '#shared/rooms';
import { ALL_KINDS, type AllKind } from '#shared/routes';
import type { SavedView } from '#shared/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/ui/toggle';
import { useDatapad } from '@/hooks/useDatapad';
import { useFlip } from '@/hooks/useFlip';
import { useMotion } from '@/providers/MotionProvider';
import { usePagePrefs } from '@/providers/PagePrefsProvider';
import { useToast } from '@/providers/ToastProvider';
import { Group, Hint, PageFields, ResetToDefaults } from './parts';

const ICON_BUTTON = 'press size-11 desk:size-8';

/**
 * Settings → All (#343): the kinds All opens on (Tasks until changed;
 * none picked is every kind), the layout each kind opens with, the sort
 * tasks and projects start with, and the saved views: rename, delete
 * (with Undo) and reorder. Saved under the `all` page; Reset to defaults
 * keeps the saved views, which are yours rather than settings.
 */
export function AllSettings() {
  const { state, actions } = useDatapad();
  const { save } = usePagePrefs();
  const { show } = useToast();
  const { active } = useMotion();
  const list = useRef<HTMLUListElement>(null);
  useFlip(list, active);

  // A move re-renders the rows: keep focus on the button pressed, or its
  // neighbor once that one is disabled at the end of the list.
  const refocus = useRef<{ id: string; by: -1 | 1 } | null>(null);
  useLayoutEffect(() => {
    const want = refocus.current;
    if (!want) return;
    refocus.current = null;
    const button = (by: number) =>
      list.current?.querySelector<HTMLButtonElement>(
        `[data-move="${CSS.escape(`${want.id}:${by}`)}"]`,
      );
    const pressed = button(want.by);
    (pressed && !pressed.disabled ? pressed : button(-want.by))?.focus();
  });

  if (!state) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const home = allHome(state);
  const views = savedViews(state);

  const setHome = (kinds: AllKind[]) => {
    const value = allHomeValue(kinds);
    const def = DEFAULT_ALL_KINDS.join(',');
    save(
      'all',
      patchOf({ [ALL_KINDS_SETTING]: value === def ? null : value }),
      true,
    );
  };
  const toggleKind = (kind: AllKind) =>
    setHome(
      home.includes(kind)
        ? home.filter((k) => k !== kind)
        : ALL_KINDS.filter((k) => k === kind || home.includes(k)),
    );

  const write = (next: SavedView[]) =>
    actions.setPagePrefs({
      page: 'all',
      patch: { views: next.length > 0 ? next : null },
    });
  const rename = (view: SavedView, text: string) => {
    const name = text.trim().slice(0, LIMITS.nameMax);
    if (!name || name === view.name) return;
    if (write(renameView(views, view.id, name))) {
      show(`Renamed the view to “${name}”`);
    }
  };
  const remove = (view: SavedView) => {
    const before = views;
    if (!write(removeView(views, view.id))) return;
    show(`Deleted the view “${view.name}”`, () => write(before));
  };
  const move = (view: SavedView, by: -1 | 1) => {
    const from = views.findIndex((v) => v.id === view.id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= views.length) return;
    const next = [...views];
    next.splice(from, 1);
    next.splice(to, 0, view);
    refocus.current = { id: view.id, by };
    if (!write(next)) refocus.current = null;
  };

  return (
    <>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          How All opens in this space, on every device. A link that names its
          own kinds, layout or sort still shows them.
        </p>
        <ResetToDefaults section="all" label="All" />
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-xs font-medium">Opens on</legend>
        <div className="flex flex-wrap gap-1">
          {ALL_KINDS.map((kind) => (
            <Toggle
              key={kind}
              variant="outline"
              className="press h-11 px-3 desk:h-8"
              pressed={home.includes(kind)}
              onPressedChange={() => toggleKind(kind)}
            >
              {KIND_LABELS[kind]}
            </Toggle>
          ))}
        </div>
        <Hint>
          What the rail’s All shows first. With none picked, every kind.
        </Hint>
      </fieldset>
      <Group title="Layouts">
        <PageFields
          page="all"
          state={state}
          keys={['taskView', 'meetingView', 'projectView']}
        />
        <Hint>The layout a kind opens with when it is shown on its own.</Hint>
      </Group>
      <Group title="Sort">
        <PageFields
          page="all"
          state={state}
          keys={['taskSort', 'projectSort']}
        />
        <Hint>
          The sort tasks or projects start with when shown on their own.
        </Hint>
      </Group>
      <Group title="Saved views">
        {views.length === 0 ? (
          <p className="text-state">
            None yet. Save one from All with Save view.
          </p>
        ) : (
          <ul
            ref={list}
            aria-label="Saved views"
            className="flex flex-col border-t"
          >
            {views.map((view, i) => (
              <li
                key={view.id}
                data-flip-id={view.id}
                className="row flex items-center gap-1 border-b bg-background py-1 text-sm"
              >
                <Input
                  // A rename from elsewhere starts the field over.
                  key={view.name}
                  defaultValue={view.name}
                  aria-label={`Name of ${view.name}`}
                  maxLength={LIMITS.nameMax}
                  autoComplete="off"
                  onBlur={(e) => rename(view, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                  className="h-11 min-w-0 flex-1 text-base desk:h-8 desk:text-xs"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className={ICON_BUTTON}
                  title="Move up"
                  data-move={`${view.id}:-1`}
                  disabled={i === 0}
                  onClick={() => move(view, -1)}
                >
                  <ArrowUpIcon />
                  <span className="sr-only">Move {view.name} up</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={ICON_BUTTON}
                  title="Move down"
                  data-move={`${view.id}:1`}
                  disabled={i === views.length - 1}
                  onClick={() => move(view, 1)}
                >
                  <ArrowDownIcon />
                  <span className="sr-only">Move {view.name} down</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={ICON_BUTTON}
                  title="Delete"
                  onClick={() => remove(view)}
                >
                  <TrashIcon />
                  <span className="sr-only">Delete {view.name}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Group>
    </>
  );
}

import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  FoldersIcon,
  type Icon,
  NewspaperIcon,
} from '@phosphor-icons/react';
import { useLayoutEffect, useRef } from 'react';
import {
  isSectionName,
  type NavExtra,
  navExtrasOf,
  navHiddenOf,
  navOrderOf,
  type SectionName,
} from '#shared/nav';
import { DEFAULT_SETTINGS, SETTINGS_ID } from '#shared/types';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useDatapad } from '@/hooks/useDatapad';
import { useFlip } from '@/hooks/useFlip';
import { NAV_ITEMS } from '@/lib/nav';
import { useMotion } from '@/providers/MotionProvider';
import { useToast } from '@/providers/ToastProvider';

const ICON_BUTTON = 'press size-11 desk:size-8';

const EXTRAS: { name: NavExtra; label: string; icon: Icon; hint: string }[] = [
  {
    name: 'activeProjects',
    label: 'Active projects',
    icon: FoldersIcon,
    hint: 'The list of active projects, most recently updated first.',
  },
  {
    name: 'digest',
    label: 'Weekly digest',
    icon: NewspaperIcon,
    hint: 'Under Active projects in the rail, once there is a project.',
  },
  {
    name: 'archived',
    label: 'Archived',
    icon: ArchiveIcon,
    hint: 'When there are archived projects.',
  },
];

/**
 * Settings → Navigation: which sections the rail and the tab bar show, in
 * what order, and the rail's extras. Saved for this space as each change
 * is made; Reset to default puts today's nav back, with Undo.
 */
export function NavSettings() {
  const { state, actions } = useDatapad();
  const { show } = useToast();
  const { active } = useMotion();
  const stored = state?.settings[SETTINGS_ID] ?? DEFAULT_SETTINGS;
  const order = navOrderOf(stored.nav);
  const hidden = navHiddenOf(stored.nav);
  const extras = navExtrasOf(stored);
  const visible = order.length - hidden.size;

  const list = useRef<HTMLUListElement>(null);
  useFlip(list, active);

  // A move re-renders the rows (and may move the one pressed): keep focus
  // on the button pressed, or its neighbour once that one is disabled.
  const refocus = useRef<{ name: SectionName; by: -1 | 1 } | null>(null);
  useLayoutEffect(() => {
    const want = refocus.current;
    if (!want) return;
    refocus.current = null;
    const button = (by: number) =>
      list.current?.querySelector<HTMLButtonElement>(
        `[data-move="${want.name}:${by}"]`,
      );
    const pressed = button(want.by);
    (pressed && !pressed.disabled ? pressed : button(-want.by))?.focus();
  });

  const move = (name: SectionName, by: -1 | 1) => {
    const from = order.indexOf(name);
    const to = from + by;
    if (from < 0 || to < 0 || to >= order.length) return;
    const next = [...order];
    next.splice(from, 1);
    next.splice(to, 0, name);
    refocus.current = { name, by };
    actions.setNav({ patch: { order: next } });
  };

  const setShown = (name: SectionName, on: boolean) => {
    const next = new Set(hidden);
    if (on) next.delete(name);
    else next.add(name);
    actions.setNav({ patch: { hidden: [...next] } });
  };

  const reset = () => {
    const before = stored.nav;
    if (!before) return;
    if (!actions.setNav({ patch: { order: null, hidden: null, extras: null } }))
      return;
    show('Navigation reset to the default', () => {
      actions.setNav({
        patch: {
          order: before.order?.filter(isSectionName) ?? null,
          hidden: before.hidden?.filter(isSectionName) ?? null,
          extras: before.extras ?? null,
        },
      });
    });
  };

  return (
    <>
      <p className="text-sm text-muted-foreground">
        The sections in the rail and the tab bar, in this order, for this space.
        A hidden section still opens from its address, ⌘K and Help. Changes save
        as you make them.
      </p>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold" id="nav-sections">
          Sections
        </h3>
        <ul
          ref={list}
          aria-labelledby="nav-sections"
          className="flex flex-col border-t"
        >
          {order.map((name, i) => {
            const { label, icon: SectionIcon } = NAV_ITEMS[name];
            const shown = !hidden.has(name);
            const lastShown = shown && visible <= 1;
            const id = `nav-show-${name}`;
            return (
              <li
                key={name}
                data-flip-id={name}
                data-section-row={name}
                className="row flex items-center gap-1 border-b bg-background text-sm"
              >
                <label
                  htmlFor={id}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 desk:min-h-9"
                >
                  <SectionIcon aria-hidden className="size-4 shrink-0" />
                  <span
                    className={
                      shown
                        ? 'font-medium'
                        : 'font-medium text-muted-foreground'
                    }
                  >
                    {label}
                  </span>
                  {!shown && (
                    <span className="text-xs text-muted-foreground">
                      Hidden
                    </span>
                  )}
                </label>
                <span className="flex size-11 shrink-0 items-center justify-center desk:size-9">
                  <Switch
                    id={id}
                    aria-label={`Show ${label}`}
                    checked={shown}
                    disabled={lastShown}
                    aria-describedby={lastShown ? 'nav-last-hint' : undefined}
                    onCheckedChange={(on) => setShown(name, on)}
                  />
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className={ICON_BUTTON}
                  title="Move up"
                  data-move={`${name}:-1`}
                  disabled={i === 0}
                  onClick={() => move(name, -1)}
                >
                  <ArrowUpIcon />
                  <span className="sr-only">Move {label} up</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={ICON_BUTTON}
                  title="Move down"
                  data-move={`${name}:1`}
                  disabled={i === order.length - 1}
                  onClick={() => move(name, 1)}
                >
                  <ArrowDownIcon />
                  <span className="sr-only">Move {label} down</span>
                </Button>
              </li>
            );
          })}
        </ul>
        <p id="nav-last-hint" className="text-xs text-muted-foreground">
          At least one section stays in the navigation. The address{' '}
          <code>/</code> is always Focus, shown or not.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold" id="nav-extras">
          In the rail
        </h3>
        <p className="text-xs text-muted-foreground">
          Below the sections, on wider screens. Each shows only when there is
          something to show.
        </p>
        <ul aria-labelledby="nav-extras" className="flex flex-col border-t">
          {EXTRAS.map(({ name, label, icon: ExtraIcon, hint }) => {
            const id = `nav-extra-${name}`;
            return (
              <li
                key={name}
                className="flex items-center gap-1 border-b text-sm"
              >
                <label
                  htmlFor={id}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 py-1 desk:min-h-9"
                >
                  <ExtraIcon aria-hidden className="size-4 shrink-0" />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">{label}</span>
                    <span className="text-xs text-muted-foreground">
                      {hint}
                    </span>
                  </span>
                </label>
                <span className="flex size-11 shrink-0 items-center justify-center desk:size-9">
                  <Switch
                    id={id}
                    aria-label={`Show ${label}`}
                    checked={extras[name]}
                    onCheckedChange={(on) =>
                      actions.setNav({ patch: { extras: { [name]: on } } })
                    }
                  />
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <Button
        variant="outline"
        className="press self-start"
        disabled={!stored.nav}
        onClick={reset}
      >
        <ArrowCounterClockwiseIcon />
        Reset to default
      </Button>
    </>
  );
}

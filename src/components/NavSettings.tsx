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
  isQuickAddAction,
  isSectionName,
  type NavExtra,
  navExtrasOf,
  navHiddenOf,
  navOrderOf,
  navPhoneHiddenOf,
  type QuickAddAction,
  quickAddHiddenOf,
  quickAddOrderOf,
  type SectionName,
} from '#shared/nav';
import { DEFAULT_SETTINGS, SETTINGS_ID } from '#shared/types';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useDatapad } from '@/hooks/useDatapad';
import { useFlip } from '@/hooks/useFlip';
import { NAV_ITEMS, QUICK_ADD_ITEMS } from '@/lib/nav';
import { useMotion } from '@/providers/MotionProvider';
import { useToast } from '@/providers/ToastProvider';

const ICON_BUTTON = 'press size-11 desk:size-8';
/** A switch's cell: 44px on touch. */
const CELL = 'flex size-11 shrink-0 items-center justify-center desk:size-9';

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
 * what order, which of those stay off the phone's tab bar (the
 * Whiteboard, by default), the rail's extras, and what the top bar's +
 * offers. Saved for this space as each change is made; Reset to default
 * puts today's nav back, with Undo.
 */
export function NavSettings() {
  const { state, actions } = useDatapad();
  const { show } = useToast();
  const { active } = useMotion();
  const stored = state?.settings[SETTINGS_ID] ?? DEFAULT_SETTINGS;
  const order = navOrderOf(stored.nav);
  const hidden = navHiddenOf(stored.nav);
  const phoneHidden = navPhoneHiddenOf(stored.nav);
  const extras = navExtrasOf(stored);
  const visible = order.length - hidden.size;
  const phoneVisible = order.filter(
    (name) => !hidden.has(name) && !phoneHidden.has(name),
  ).length;
  const addOrder = quickAddOrderOf(stored.nav?.quickAdd);
  const addHidden = quickAddHiddenOf(stored.nav?.quickAdd);
  const addVisible = addOrder.length - addHidden.size;

  const list = useRef<HTMLUListElement>(null);
  useFlip(list, active);
  const addList = useRef<HTMLUListElement>(null);
  useFlip(addList, active);

  // A move re-renders the rows (and may move the one pressed): keep focus
  // on the button pressed, or its neighbour once that one is disabled.
  const refocus = useRef<{ name: string; by: -1 | 1 } | null>(null);
  useLayoutEffect(() => {
    const want = refocus.current;
    if (!want) return;
    refocus.current = null;
    const button = (by: number) =>
      document.querySelector<HTMLButtonElement>(
        `[data-move="${want.name}:${by}"]`,
      );
    const pressed = button(want.by);
    (pressed && !pressed.disabled ? pressed : button(-want.by))?.focus();
  });

  const move = (name: SectionName, by: -1 | 1) => {
    const next = moved(order, name, by);
    if (!next) return;
    refocus.current = { name, by };
    actions.setNav({ patch: { order: next } });
  };

  // The + menu is saved whole, order and hidden together, so an action a
  // later release adds is one it has never named and keeps its default.
  const saveQuickAdd = (
    next: QuickAddAction[],
    nextHidden: Set<QuickAddAction>,
  ) =>
    actions.setNav({
      patch: { quickAdd: { order: next, hidden: [...nextHidden] } },
    });

  const moveAdd = (name: QuickAddAction, by: -1 | 1) => {
    const next = moved(addOrder, name, by);
    if (!next) return;
    refocus.current = { name: `add-${name}`, by };
    saveQuickAdd(next, addHidden);
  };

  const setAddShown = (name: QuickAddAction, on: boolean) => {
    const next = new Set(addHidden);
    if (on) next.delete(name);
    else next.add(name);
    saveQuickAdd(addOrder, next);
  };

  const setShown = (name: SectionName, on: boolean) => {
    const next = new Set(hidden);
    if (on) next.delete(name);
    else next.add(name);
    actions.setNav({ patch: { hidden: [...next] } });
  };

  // Saved whole, with the order naming every section there is today, so
  // one a later release adds is one the lists have never named and keeps
  // its default.
  const setOnPhone = (name: SectionName, on: boolean) => {
    const next = new Set(phoneHidden);
    if (on) next.delete(name);
    else next.add(name);
    actions.setNav({ patch: { order, phoneHidden: [...next] } });
  };

  const reset = () => {
    const before = stored.nav;
    if (!before) return;
    if (
      !actions.setNav({
        patch: {
          order: null,
          hidden: null,
          phoneHidden: null,
          extras: null,
          quickAdd: null,
        },
      })
    )
      return;
    show('Navigation reset to the default', () => {
      actions.setNav({
        patch: {
          order: before.order?.filter(isSectionName) ?? null,
          hidden: before.hidden?.filter(isSectionName) ?? null,
          phoneHidden: before.phoneHidden?.filter(isSectionName) ?? null,
          extras: before.extras ?? null,
          quickAdd: before.quickAdd
            ? {
                order: before.quickAdd.order?.filter(isQuickAddAction) ?? [],
                hidden: before.quickAdd.hidden?.filter(isQuickAddAction) ?? [],
              }
            : null,
        },
      });
    });
  };

  return (
    <>
      <p className="text-sm text-muted-foreground">
        The sections in the rail and the tab bar, in this order, for this space.
        Phone keeps a section off the phone’s tab bar (the Whiteboard, by
        default; the account menu has it then). A hidden section still opens
        from its address, ⌘K and Help. Changes save as you make them.
      </p>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold" id="nav-sections">
          Sections
        </h3>
        <div
          aria-hidden
          className="flex items-center gap-1 text-xs text-muted-foreground"
        >
          <span className="flex-1" />
          <span className={`${CELL} text-center`}>Show</span>
          <span className={`${CELL} text-center`}>Phone</span>
          <span className={ICON_BUTTON} />
          <span className={ICON_BUTTON} />
        </div>
        <ul
          ref={list}
          aria-labelledby="nav-sections"
          className="flex flex-col border-t"
        >
          {order.map((name, i) => {
            const { label, icon } = NAV_ITEMS[name];
            const shown = !hidden.has(name);
            const onPhone = shown && !phoneHidden.has(name);
            return (
              <OrderRow
                key={name}
                name={name}
                label={label}
                icon={icon}
                rowAttr={{ 'data-section-row': name }}
                switchId={`nav-show-${name}`}
                moveKey={name}
                shown={shown}
                lastShown={shown && visible <= 1}
                lastHint="nav-last-hint"
                phone={{
                  on: onPhone,
                  last: onPhone && phoneVisible <= 1,
                  onChange: (on) => setOnPhone(name, on),
                }}
                first={i === 0}
                last={i === order.length - 1}
                onShow={(on) => setShown(name, on)}
                onMove={(by) => move(name, by)}
              />
            );
          })}
        </ul>
        <p id="nav-last-hint" className="text-xs text-muted-foreground">
          At least one section stays in the navigation, and one on the phone.
          The address <code>/</code> is always Focus, shown or not.
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

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold" id="nav-quick-add">
          Quick add
        </h3>
        <p className="text-xs text-muted-foreground">
          What the top bar’s + offers, in this order. With one shown, + does it
          directly. A hidden one still works from its shortcut, ⌘K and its
          page’s own button.
        </p>
        <ul
          ref={addList}
          aria-labelledby="nav-quick-add"
          className="flex flex-col border-t"
        >
          {addOrder.map((name, i) => {
            const { label, icon } = QUICK_ADD_ITEMS[name];
            const shown = !addHidden.has(name);
            return (
              <OrderRow
                key={name}
                name={name}
                label={label}
                icon={icon}
                rowAttr={{ 'data-quick-add-row': name }}
                switchId={`nav-add-${name}`}
                moveKey={`add-${name}`}
                shown={shown}
                lastShown={shown && addVisible <= 1}
                lastHint="nav-add-last-hint"
                first={i === 0}
                last={i === addOrder.length - 1}
                onShow={(on) => setAddShown(name, on)}
                onMove={(by) => moveAdd(name, by)}
              />
            );
          })}
        </ul>
        <p id="nav-add-last-hint" className="text-xs text-muted-foreground">
          At least one action stays on +.
        </p>
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

/**
 * One row of an ordered list (a section, a + action): its icon and label,
 * a Show switch, a Phone switch for a section (whether the phone's tab bar
 * has it; off while the section is hidden) and Move up / Move down, 44px
 * on touch. `moveKey` names its move buttons so focus can follow a move.
 */
function OrderRow({
  name,
  label,
  icon: RowIcon,
  rowAttr,
  switchId,
  moveKey,
  shown,
  lastShown,
  lastHint,
  phone,
  first,
  last,
  onShow,
  onMove,
}: {
  name: string;
  label: string;
  icon: Icon;
  rowAttr: Record<`data-${string}`, string>;
  switchId: string;
  moveKey: string;
  shown: boolean;
  /** The only one shown: it cannot be hidden. */
  lastShown: boolean;
  /** The id of the line that says why. */
  lastHint: string;
  /** A section's place on the phone's tab bar; a + action has none. */
  phone?: { on: boolean; last: boolean; onChange: (on: boolean) => void };
  first: boolean;
  last: boolean;
  onShow: (on: boolean) => void;
  onMove: (by: -1 | 1) => void;
}) {
  return (
    <li
      data-flip-id={name}
      {...rowAttr}
      className="row flex items-center gap-1 border-b bg-background text-sm"
    >
      <label
        htmlFor={switchId}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 desk:min-h-9"
      >
        <RowIcon aria-hidden className="size-4 shrink-0" />
        <span
          className={
            shown ? 'font-medium' : 'font-medium text-muted-foreground'
          }
        >
          {label}
        </span>
        {!shown && (
          <span className="text-xs text-muted-foreground">Hidden</span>
        )}
      </label>
      <span className={CELL}>
        <Switch
          id={switchId}
          aria-label={`Show ${label}`}
          checked={shown}
          disabled={lastShown}
          aria-describedby={lastShown ? lastHint : undefined}
          onCheckedChange={onShow}
        />
      </span>
      {phone && (
        <span className={CELL}>
          <Switch
            id={`${switchId}-phone`}
            aria-label={`${label} on the phone`}
            checked={phone.on}
            disabled={!shown || phone.last}
            aria-describedby={phone.last ? lastHint : undefined}
            onCheckedChange={phone.onChange}
          />
        </span>
      )}
      <Button
        variant="ghost"
        size="icon"
        className={ICON_BUTTON}
        title="Move up"
        data-move={`${moveKey}:-1`}
        disabled={first}
        onClick={() => onMove(-1)}
      >
        <ArrowUpIcon />
        <span className="sr-only">Move {label} up</span>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={ICON_BUTTON}
        title="Move down"
        data-move={`${moveKey}:1`}
        disabled={last}
        onClick={() => onMove(1)}
      >
        <ArrowDownIcon />
        <span className="sr-only">Move {label} down</span>
      </Button>
    </li>
  );
}

/** `order` with `name` moved one place, or null at either end. */
function moved<T>(order: T[], name: T, by: -1 | 1): T[] | null {
  const from = order.indexOf(name);
  const to = from + by;
  if (from < 0 || to < 0 || to >= order.length) return null;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, name);
  return next;
}

import { DotsThreeIcon, PencilSimpleIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** A detail page's header button: 44px to a finger. */
const BUTTON = 'press h-11 desk:h-8';
/** A menu row: 44px to a finger. */
const ROW = 'min-h-11 desk:min-h-0';

export interface MenuAction {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  /** Last, after a rule (Archive). */
  end?: boolean;
  /** Last, after a rule, in the destructive color (Delete). */
  destructive?: boolean;
  /** Left out of the menu (it does not apply here). */
  hidden?: boolean;
}

/**
 * The actions in a detail page's header (a project's, a meeting's, a
 * task's), the same everywhere: the page's state action when it has one
 * (Close or Reopen), Edit, then a More menu with the rest, the less common
 * first, then Archive or Delete after a rule. An empty menu is left out.
 */
export function DetailActions({
  primary,
  onEdit,
  menu,
}: {
  primary?: { label: string; icon: ReactNode; onClick: () => void };
  onEdit: () => void;
  menu: MenuAction[];
}) {
  const shown = menu.filter((a) => !a.hidden);
  const common = shown.filter((a) => !a.end && !a.destructive);
  const last = shown.filter((a) => a.end || a.destructive);
  return (
    <div className="flex flex-wrap gap-1">
      {primary && (
        <Button variant="outline" className={BUTTON} onClick={primary.onClick}>
          {primary.icon}
          {primary.label}
        </Button>
      )}
      <Button variant="outline" className={BUTTON} onClick={onEdit}>
        <PencilSimpleIcon />
        Edit
      </Button>
      {shown.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                className={`${BUTTON} w-11 px-0 desk:w-8`}
                aria-label="More actions"
                title="More actions"
              />
            }
          >
            <DotsThreeIcon weight="bold" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {common.map((a) => (
              <DropdownMenuItem
                key={a.label}
                className={ROW}
                onClick={a.onSelect}
              >
                {a.icon}
                {a.label}
              </DropdownMenuItem>
            ))}
            {common.length > 0 && last.length > 0 && <DropdownMenuSeparator />}
            {last.map((a) => (
              <DropdownMenuItem
                key={a.label}
                className={ROW}
                variant={a.destructive ? 'destructive' : 'default'}
                onClick={a.onSelect}
              >
                {a.icon}
                {a.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

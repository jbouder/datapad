import {
  BuildingsIcon,
  GearSixIcon,
  PlusIcon,
  SignOutIcon,
  UserCircleIcon,
  UsersIcon,
} from '@phosphor-icons/react';
import { SPACE_ROW, useNewSpace } from '@/components/SpaceSwitcher';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { SIGN_OUT_URL } from '@/lib/api';
import { linkProps } from '@/lib/router';
import { isThemeId, THEMES } from '@/lib/themes';
import { useSpaces } from '@/providers/DatapadProvider';
import { useMotion } from '@/providers/MotionProvider';
import { useTheme } from '@/providers/ThemeProvider';

/**
 * The account menu: who is signed in, the spaces (the phone's switcher;
 * picking one closes the menu) and New space…, quick Motion and Theme
 * switches, then Settings and Sign out. On phones, where the tab bar has no room
 * for them, People and Orgs come first in that group.
 */
export function PreferencesMenu({ email }: { email: string | null }) {
  const { theme, setTheme } = useTheme();
  const motion = useMotion();
  const { spaces, current, switchSpace } = useSpaces();
  const { openNewSpace } = useNewSpace();
  const phone = useMediaQuery('(width < 820px)');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="press size-11 sm:size-9"
            aria-label="Account and settings"
          />
        }
      >
        <UserCircleIcon weight="bold" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate">
            {email ? `Signed in as ${email}` : 'Signed in'}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Space</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={current.id}
            onValueChange={switchSpace}
          >
            {spaces.map((s) => (
              <DropdownMenuRadioItem
                key={s.id}
                value={s.id}
                closeOnClick
                className={SPACE_ROW}
              >
                <span className="truncate">{s.name}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuItem className={SPACE_ROW} onClick={openNewSpace}>
            <PlusIcon />
            New space…
          </DropdownMenuItem>
          <DropdownMenuItem
            className={SPACE_ROW}
            render={
              <a {...linkProps({ name: 'settings', section: 'spaces' })} />
            }
          >
            <GearSixIcon />
            Manage spaces
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuCheckboxItem
            closeOnClick={false}
            checked={motion.preference}
            disabled={motion.reduced}
            onCheckedChange={(on) => motion.setPreference(on)}
          >
            <span className="flex-1">Motion</span>
            {motion.reduced && (
              <span className="text-muted-foreground">off by your OS</span>
            )}
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={theme}
            onValueChange={(value) => {
              if (isThemeId(value)) setTheme(value);
            }}
          >
            {THEMES.map((t) => (
              <DropdownMenuRadioItem
                key={t.id}
                value={t.id}
                closeOnClick={false}
              >
                {t.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {phone && (
            <>
              <DropdownMenuItem
                render={<a {...linkProps({ name: 'people' })} />}
              >
                <UsersIcon />
                People
              </DropdownMenuItem>
              <DropdownMenuItem render={<a {...linkProps({ name: 'orgs' })} />}>
                <BuildingsIcon />
                Orgs
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem
            render={
              <a {...linkProps({ name: 'settings', section: 'appearance' })} />
            }
          >
            <GearSixIcon />
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem render={<a href={SIGN_OUT_URL} />}>
            <SignOutIcon />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

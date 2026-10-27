import {
  ArrowClockwiseIcon,
  ChalkboardSimpleIcon,
  GearSixIcon,
  QuestionIcon,
  SignOutIcon,
  UserCircleIcon,
} from '@phosphor-icons/react';
import { SPACE_ROW } from '@/components/SpaceSwitcher';
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
import { SIGN_OUT_URL } from '@/lib/api';
import { useNav } from '@/lib/nav';
import { linkProps } from '@/lib/router';
import { isThemeId, THEMES } from '@/lib/themes';
import { useSpaces } from '@/providers/DatapadProvider';
import { useMotion } from '@/providers/MotionProvider';
import { useTheme } from '@/providers/ThemeProvider';

/**
 * The account menu: who is signed in, the spaces (the phone's switcher;
 * picking one closes the menu; Settings → Spaces makes and manages them),
 * quick Motion and Theme switches, then the space's Whiteboard (on a
 * phone whose tab bar leaves it out, as it does by default; the rail has
 * it on desktop), Refresh, Help, Settings and Sign out.
 */
export function PreferencesMenu({ email }: { email: string | null }) {
  const { theme, setTheme } = useTheme();
  const motion = useMotion();
  const { spaces, current, switchSpace } = useSpaces();
  const phoneHasBoard = useNav().phoneItems.some(
    (item) => item.name === 'whiteboard',
  );

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
          {/* The rail has it on desktop; the tab bar can. */}
          {!phoneHasBoard && (
            <DropdownMenuItem
              className="desk:hidden"
              render={<a {...linkProps({ name: 'whiteboard' })} />}
            >
              <ChalkboardSimpleIcon />
              Whiteboard
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => window.location.reload()}>
            <ArrowClockwiseIcon />
            Refresh
          </DropdownMenuItem>
          <DropdownMenuItem render={<a {...linkProps({ name: 'help' })} />}>
            <QuestionIcon />
            Help
          </DropdownMenuItem>
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

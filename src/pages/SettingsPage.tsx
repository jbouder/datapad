import {
  DownloadSimpleIcon,
  SignOutIcon,
  UploadSimpleIcon,
} from '@phosphor-icons/react';
import { useLayoutEffect, useRef } from 'react';
import { formatTime } from '#shared/dates';
import { countDocuments } from '#shared/protocol';
import { Backups } from '@/components/Backups';
import { describeCounts, useImportExport } from '@/components/ImportExport';
import { Segmented } from '@/components/inputs/Segmented';
import { OrgsView } from '@/components/orgs/OrgsView';
import { PeopleView } from '@/components/people/PeopleView';
import { SpacesSettings } from '@/components/SpacesSettings';
import { SummarySettings } from '@/components/summary/SummarySettings';
import { TemplatesSettings } from '@/components/templates/TemplatesSettings';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { setClock, useClock } from '@/hooks/useClock';
import { useDatapad } from '@/hooks/useDatapad';
import { usePageTitle } from '@/hooks/usePageTitle';
import { SIGN_OUT_URL } from '@/lib/api';
import {
  linkProps,
  SETTINGS_SECTIONS,
  type SettingsSection,
  settingsRoute,
} from '@/lib/router';
import { isThemeId, THEMES } from '@/lib/themes';
import { cn } from '@/lib/utils';
import { useEmail, useSpaces } from '@/providers/DatapadProvider';
import { useMotion } from '@/providers/MotionProvider';
import { useTheme } from '@/providers/ThemeProvider';

const LABELS: Record<SettingsSection, string> = {
  appearance: 'Appearance',
  templates: 'Templates',
  summaries: 'Summaries',
  spaces: 'Spaces',
  people: 'People',
  orgs: 'Orgs',
  data: 'Data',
  account: 'Account',
};

/**
 * Everything that is not day-to-day work: how Datapad looks and moves,
 * templates, summaries, your spaces, the people and orgs the rest of the
 * app refers to, your data in and out, and who is signed in. Each section
 * has its own address (`/settings/data`, `/settings/people/:id`); the
 * account menu leads here.
 */
export function SettingsPage({
  section,
  person,
  org,
}: {
  section: SettingsSection;
  /** The person selected in People. */
  person?: string;
  /** The org open in Orgs. */
  org?: string;
}) {
  usePageTitle(`${LABELS[section]} · Settings`);
  // On phones the sections scroll sideways: keep the open one in view. The
  // web font can land after the first layout and widen every label, so the
  // same reveal runs again once the fonts are ready.
  const nav = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    let live = true;
    const reveal = () => {
      const strip = nav.current;
      const link = strip?.querySelector<HTMLElement>(
        `[data-section="${section}"]`,
      );
      if (!live || !strip || !link) return;
      if (strip.scrollWidth <= strip.clientWidth) return;
      const left =
        link.getBoundingClientRect().left -
        strip.getBoundingClientRect().left +
        strip.scrollLeft;
      const right = left + link.offsetWidth;
      if (left < strip.scrollLeft) {
        strip.scrollLeft = left;
      } else if (right > strip.scrollLeft + strip.clientWidth) {
        strip.scrollLeft = right - strip.clientWidth;
      }
    };
    reveal();
    document.fonts?.ready.then(reveal);
    return () => {
      live = false;
    };
  }, [section]);
  return (
    <div className="enter flex flex-col gap-6">
      <h1 className="text-page-title">Settings</h1>
      <div className="grid grid-cols-1 gap-6 desk:grid-cols-[11rem_minmax(0,1fr)]">
        <nav
          ref={nav}
          aria-label="Settings"
          className="-mx-4 overflow-x-auto px-4 desk:mx-0 desk:px-0"
        >
          <ul className="flex gap-1 desk:flex-col">
            {SETTINGS_SECTIONS.map((s) => (
              <li key={s} className="shrink-0">
                <a
                  {...linkProps(settingsRoute(s))}
                  data-section={s}
                  aria-current={s === section ? 'page' : undefined}
                  className={cn(
                    'press flex min-h-11 items-center px-3 text-sm outline-ring/50 hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 desk:min-h-9',
                    s === section &&
                      'bg-accent font-semibold text-accent-foreground',
                  )}
                >
                  {LABELS[s]}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <section
          aria-labelledby="settings-section"
          className={cn(
            'flex min-w-0 flex-col gap-6',
            // People's detail pane sits beside the list.
            section !== 'people' && 'max-w-2xl',
          )}
        >
          <h2
            id="settings-section"
            className="font-heading text-xl font-semibold"
          >
            {LABELS[section]}
          </h2>
          {section === 'appearance' && <Appearance />}
          {section === 'templates' && <TemplatesSettings />}
          {section === 'summaries' && <SummarySettings />}
          {section === 'spaces' && <SpacesSettings />}
          {section === 'people' && <PeopleView selected={person} />}
          {section === 'orgs' && <OrgsView selected={org} />}
          {section === 'data' && <Data />}
          {section === 'account' && <Account />}
        </section>
      </div>
    </div>
  );
}

function Appearance() {
  const { theme, setTheme } = useTheme();
  const motion = useMotion();
  const clock = useClock();
  return (
    <>
      <div className="flex flex-col gap-2">
        <Segmented
          legend="Theme"
          value={theme}
          onChange={(value) => {
            if (isThemeId(value)) setTheme(value);
          }}
          options={THEMES.map((t) => ({ value: t.id, label: t.label }))}
        />
        <p className="text-xs text-muted-foreground">
          System follows your device. Remembered on this device.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Segmented
          legend="Time"
          value={clock}
          onChange={(value) => setClock(value === '24h' ? '24h' : '12h')}
          options={[
            { value: '12h', label: '12-hour' },
            { value: '24h', label: '24-hour' },
          ]}
        />
        <p className="text-xs text-muted-foreground">
          {formatTime('14:30', clock)} or {formatTime('09:05', clock)}.
          Remembered on this device.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <label
          htmlFor="motion-switch"
          className="flex min-h-11 items-center justify-between gap-4 text-sm desk:min-h-8"
        >
          <span className="flex flex-col">
            <span className="font-medium">Motion</span>
            <span className="text-xs text-muted-foreground">
              {motion.reduced
                ? 'Off: your device asks for reduced motion.'
                : 'Page transitions, panels sliding in, rows moving into place.'}
            </span>
          </span>
          <Switch
            id="motion-switch"
            checked={motion.active}
            disabled={motion.reduced}
            onCheckedChange={(on) => motion.setPreference(on)}
          />
        </label>
      </div>
    </>
  );
}

function Data() {
  const { state } = useDatapad();
  const data = useImportExport();
  // Everything here acts on the open space; the headings say which.
  const { name } = useSpaces().current;
  const counts = state ? countDocuments(state) : null;
  return (
    <>
      {counts && (
        <p className="text-sm">
          {name} has {describeCounts(counts)}.
        </p>
      )}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Export {name}</h3>
        <p className="text-sm text-muted-foreground">
          Every document in {name} as one JSON file, yours to keep. It imports
          into Datapad again.
        </p>
        <Button
          variant="outline"
          className="press self-start"
          onClick={data.exportNow}
        >
          <DownloadSimpleIcon />
          Export
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Import into {name}</h3>
        <p className="text-sm text-muted-foreground">
          A Datapad export, or the original tracker’s <code>ledger-*.json</code>
          . Same ids are replaced; everything else stays. You confirm first.
        </p>
        <Button
          variant="outline"
          className="press self-start"
          onClick={data.chooseImport}
        >
          <UploadSimpleIcon />
          Import…
        </Button>
      </div>
      <Backups />
    </>
  );
}

function Account() {
  const email = useEmail();
  return (
    <>
      <p className="text-sm">
        Signed in as <strong className="font-semibold">{email ?? '…'}</strong>{' '}
        through Cloudflare Access. Only this address can open your Datapad.
      </p>
      <a
        href={SIGN_OUT_URL}
        className="press inline-flex h-11 items-center gap-2 self-start border px-3 text-sm hover:bg-accent desk:h-9"
      >
        <SignOutIcon />
        Sign out
      </a>
    </>
  );
}

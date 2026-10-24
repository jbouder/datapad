import {
  DownloadSimpleIcon,
  SignOutIcon,
  UploadSimpleIcon,
} from '@phosphor-icons/react';
import { type FormEvent, useMemo, useState } from 'react';
import { LIMITS } from '#shared/limits';
import { countDocuments } from '#shared/protocol';
import { type Person, settingsOf } from '#shared/types';
import { Field } from '@/components/Field';
import { describeCounts, useImportExport } from '@/components/ImportExport';
import { Segmented } from '@/components/inputs/Segmented';
import { OrgPicker } from '@/components/pickers/OrgPicker';
import { PersonForm } from '@/components/settings/PersonForm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useDatapad } from '@/hooks/useDatapad';
import { usePageTitle } from '@/hooks/usePageTitle';
import { SIGN_OUT_URL } from '@/lib/api';
import {
  linkProps,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from '@/lib/router';
import { isThemeId, THEMES } from '@/lib/themes';
import { cn } from '@/lib/utils';
import { useEmail } from '@/providers/DatapadProvider';
import { useMotion } from '@/providers/MotionProvider';
import { useTheme } from '@/providers/ThemeProvider';
import { useToast } from '@/providers/ToastProvider';

const LABELS: Record<SettingsSection, string> = {
  appearance: 'Appearance',
  people: 'People',
  orgs: 'Orgs',
  data: 'Data',
  account: 'Account',
};

/**
 * Everything that is not day-to-day work: how Datapad looks and moves,
 * the people and orgs the rest of the app refers to, your data in and
 * out, and who is signed in. Each section has its own address
 * (`/settings/people`); the account menu leads here.
 */
export function SettingsPage({ section }: { section: SettingsSection }) {
  usePageTitle(`${LABELS[section]} · Settings`);
  return (
    <div className="enter flex flex-col gap-6">
      <h1 className="text-page-title">Settings</h1>
      <div className="grid grid-cols-1 gap-6 desk:grid-cols-[11rem_minmax(0,1fr)]">
        <nav
          aria-label="Settings"
          className="-mx-4 overflow-x-auto px-4 desk:mx-0 desk:px-0"
        >
          <ul className="flex gap-1 desk:flex-col">
            {SETTINGS_SECTIONS.map((s) => (
              <li key={s} className="shrink-0">
                <a
                  {...linkProps({ name: 'settings', section: s })}
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
          className="flex min-w-0 max-w-2xl flex-col gap-6"
        >
          <h2
            id="settings-section"
            className="font-heading text-xl font-semibold"
          >
            {LABELS[section]}
          </h2>
          {section === 'appearance' && <Appearance />}
          {section === 'people' && <People />}
          {section === 'orgs' && <Orgs />}
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

function People() {
  const { state, actions } = useDatapad();
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [editing, setEditing] = useState<{
    key: number;
    id: string;
    open: boolean;
  } | null>(null);

  const people = useMemo(
    () =>
      Object.values(state?.people ?? {}).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [state?.people],
  );
  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of Object.values(state?.tasks ?? {})) {
      if (t.assignee && t.status === 'open') {
        counts.set(t.assignee, (counts.get(t.assignee) ?? 0) + 1);
      }
    }
    return counts;
  }, [state?.tasks]);

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    if (actions.addPerson({ name, role })) {
      setName('');
      setRole('');
      document.getElementById('new-person-name')?.focus();
    }
  };
  const person: Person | undefined = editing
    ? state?.people[editing.id]
    : undefined;

  return (
    <>
      <p className="text-sm text-muted-foreground">
        The people you assign, add to projects and mention. Mark yourself to use
        the “Mine” filters.
      </p>
      <form
        onSubmit={add}
        className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
      >
        <Input
          id="new-person-name"
          aria-label="Name"
          placeholder="Name"
          value={name}
          maxLength={LIMITS.nameMax}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
          className="h-11 text-base desk:h-9 desk:text-sm"
        />
        <Input
          aria-label="Role"
          placeholder="Role (optional)"
          value={role}
          maxLength={LIMITS.nameMax}
          autoComplete="off"
          onChange={(e) => setRole(e.target.value)}
          className="h-11 text-base desk:h-9 desk:text-sm"
        />
        <Button type="submit" className="press h-11 desk:h-9">
          Add person
        </Button>
      </form>
      {people.length === 0 ? (
        <p className="text-state">
          No people yet. Add your team members above.
        </p>
      ) : (
        <ul aria-label="People" className="flex flex-col border-t">
          {people.map((p) => (
            <li
              key={p.id}
              className="row flex items-center gap-3 border-b text-sm"
            >
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{p.name}</span>
                {p.me && (
                  <span className="ml-2 bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-accent-foreground">
                    you
                  </span>
                )}
                {p.role && (
                  <span className="ml-2 text-muted-foreground">{p.role}</span>
                )}
              </span>
              <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
                {usage.get(p.id) ?? 0} open
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="press min-h-11 desk:min-h-8"
                onClick={() =>
                  setEditing({ key: Date.now(), id: p.id, open: true })
                }
              >
                Edit<span className="sr-only"> {p.name}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      {editing && person && (
        <PersonForm
          key={editing.key}
          person={person}
          open={editing.open}
          onClose={() => setEditing((e) => (e ? { ...e, open: false } : e))}
          onExited={() => setEditing((e) => (e?.open ? e : null))}
        />
      )}
    </>
  );
}

function Orgs() {
  const { state, actions } = useDatapad();
  const { show } = useToast();
  const defaultOrg = state ? settingsOf(state).defaultOrg : '';
  const orgs = useMemo(() => {
    const counts = new Map<string, number>();
    if (defaultOrg) counts.set(defaultOrg, 0);
    for (const p of Object.values(state?.projects ?? {})) {
      const org = p.org.trim();
      if (org) counts.set(org, (counts.get(org) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [state?.projects, defaultOrg]);
  return (
    <>
      <p className="text-sm text-muted-foreground">
        The clients and orgs your projects belong to. Pick or add one in a
        project’s form; they become full records of their own in a later
        release.
      </p>
      <div className="flex flex-col gap-1.5">
        <Field
          label="Default org"
          hint="New projects start in this org. Change it in a project’s form."
        >
          <OrgPicker
            value={defaultOrg}
            onChange={(org) => {
              if (org === defaultOrg) return;
              if (actions.setSettings({ patch: { defaultOrg: org } })) {
                show(org ? `New projects start in ${org}` : 'No default org');
              }
            }}
          />
        </Field>
      </div>
      {orgs.length === 0 ? (
        <p className="text-state">No orgs yet. Give a project an org.</p>
      ) : (
        <ul aria-label="Orgs" className="flex flex-col border-t">
          {orgs.map(([org, count]) => (
            <li
              key={org}
              className="row flex items-center gap-3 border-b text-sm"
            >
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{org}</span>
                {org === defaultOrg && (
                  <span className="ml-2 bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-accent-foreground">
                    default
                  </span>
                )}
              </span>
              {count > 0 ? (
                <a
                  {...linkProps(
                    { name: 'projects' },
                    new URLSearchParams({ status: 'all', org }).toString(),
                  )}
                  className="flex min-h-11 items-center text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground desk:min-h-8"
                >
                  {count === 1 ? '1 project' : `${count} projects`}
                </a>
              ) : (
                <span className="text-xs text-muted-foreground">
                  No projects
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Data() {
  const { state } = useDatapad();
  const data = useImportExport();
  const counts = state ? countDocuments(state) : null;
  return (
    <>
      {counts && <p className="text-sm">You have {describeCounts(counts)}.</p>}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Export</h3>
        <p className="text-sm text-muted-foreground">
          Every document as one JSON file, yours to keep. It imports into
          Datapad again.
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
        <h3 className="text-sm font-semibold">Import</h3>
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

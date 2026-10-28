import {
  ArrowLeftIcon,
  PencilSimpleIcon,
  PlusIcon,
  SparkleIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { formatDay } from '#shared/dates';
import { byWhen } from '#shared/meetings';
import { organizePlan, orgProjects, unorganized } from '#shared/orgs';
import { healthOf, type Org, settingsOf } from '#shared/types';
import { ExternalLink } from '@/components/ExternalLink';
import { Field } from '@/components/Field';
import { Initials } from '@/components/Initials';
import { Markdown } from '@/components/Markdown';
import { OrgForm } from '@/components/orgs/OrgForm';
import { OrgKindPill } from '@/components/orgs/OrgKind';
import { OrgPicker } from '@/components/pickers/OrgPicker';
import { HealthBadge } from '@/components/projects/Health';
import { StatusPill } from '@/components/projects/StatusPill';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { useToday } from '@/hooks/useNow';
import { newId } from '@/lib/ids';
import { linkProps } from '@/lib/router';
import { useToast } from '@/providers/ToastProvider';

/**
 * Orgs: the default org, every org as a record (kind, project
 * count) and, at `/settings/orgs/:id`, one org's page: its projects,
 * contacts, upcoming meetings, notes and links. Until orgs are organized,
 * projects carry plain org text; "Organize orgs" turns that into records.
 */
export function OrgsView({ selected }: { selected?: string }) {
  const { state } = useDatapad();
  const [form, setForm] = useState<{
    key: number;
    org?: Org;
    open: boolean;
  } | null>(null);
  const edit = (org?: Org) => setForm({ key: Date.now(), org, open: true });

  const org = selected ? state?.orgs[selected] : undefined;
  return (
    <>
      {selected ? (
        org ? (
          <OrgDetail org={org} onEdit={() => edit(org)} />
        ) : (
          <p className="text-state">That org no longer exists.</p>
        )
      ) : (
        <OrgList onAdd={() => edit()} />
      )}
      {form && (
        <OrgForm
          key={form.key}
          org={form.org}
          open={form.open}
          onClose={() => setForm((f) => (f ? { ...f, open: false } : f))}
          onExited={() => setForm((f) => (f?.open ? f : null))}
        />
      )}
    </>
  );
}

function OrganizeCallout() {
  const { state, actions } = useDatapad();
  const { show } = useToast();
  if (!state) return null;
  const waiting = unorganized(state);
  if (waiting === 0) return null;
  const organize = () => {
    const plan = organizePlan(state, settingsOf(state).defaultOrg, newId);
    if (actions.organizeOrgs({ orgs: plan })) {
      show(
        plan.length === 1
          ? 'Made 1 org from your projects'
          : `Made ${plan.length} orgs from your projects`,
      );
    }
  };
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 border border-dashed px-3 py-2 text-sm"
    >
      <p className="min-w-0 flex-1">
        {waiting === 1 ? '1 project names' : `${waiting} projects name`} an org
        as plain text. Organize them into org records you can add contacts,
        notes and links to. Their text stays as it is.
      </p>
      <Button className="press" onClick={organize}>
        <SparkleIcon />
        Organize orgs
      </Button>
    </div>
  );
}

function OrgList({ onAdd }: { onAdd: () => void }) {
  const { state, actions } = useDatapad();
  const { show } = useToast();
  const defaultOrg = state ? settingsOf(state).defaultOrg : '';
  const counts = state ? orgProjects(state.projects, state.orgs) : new Map();
  const orgs = useMemo(
    () =>
      Object.values(state?.orgs ?? {}).sort(
        (a, b) =>
          Number(a.archived) - Number(b.archived) ||
          a.name.localeCompare(b.name),
      ),
    [state?.orgs],
  );
  return (
    <>
      <p className="text-sm text-muted-foreground">
        The clients, teams, vendors and partners your projects belong to.
      </p>
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
      <OrganizeCallout />
      <div className="flex items-center gap-3">
        <h2 className="flex-1 text-sm font-semibold">Orgs</h2>
        <Button variant="outline" className="press" onClick={onAdd}>
          <PlusIcon />
          Add org
        </Button>
      </div>
      {orgs.length === 0 ? (
        <p className="text-state">No org records yet.</p>
      ) : (
        <ul aria-label="Orgs" className="flex flex-col border-t">
          {orgs.map((o) => {
            const n = counts.get(o.id)?.length ?? 0;
            return (
              <li
                key={o.id}
                className="row flex items-center gap-3 border-b text-sm"
              >
                <a
                  {...linkProps({ name: 'orgs', org: o.id })}
                  className="min-w-0 flex-1 truncate font-medium hover:underline hover:underline-offset-4"
                >
                  {o.name}
                  {o.archived && (
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      (archived)
                    </span>
                  )}
                </a>
                {o.name === defaultOrg && (
                  <span className="bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-accent-foreground">
                    default
                  </span>
                )}
                <OrgKindPill kind={o.kind} />
                <span className="w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                  {n === 1 ? '1 project' : `${n} projects`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function OrgDetail({ org, onEdit }: { org: Org; onEdit: () => void }) {
  const { state, actions } = useDatapad();
  const { show } = useToast();
  const today = useToday();
  const [confirming, setConfirming] = useState(false);
  if (!state) return null;
  const projects = orgProjects(state.projects, state.orgs).get(org.id) ?? [];
  const ids = new Set(projects.map((p) => p.id));
  const meetings = Object.values(state.meetings)
    .filter((e) => e.projectId && ids.has(e.projectId) && e.date >= today)
    .sort(byWhen)
    .slice(0, 5);
  const contacts = org.contacts
    .map((id) => state.people[id])
    .filter((p) => p !== undefined);

  const remove = () => {
    if (!actions.deleteOrg({ id: org.id })) return;
    show(`Deleted ${org.name}. Its projects keep the name.`);
    window.history.back();
  };

  return (
    <article aria-labelledby="org-title" className="flex flex-col gap-5">
      <a
        {...linkProps({ name: 'orgs' })}
        className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon aria-hidden />
        All orgs
      </a>
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="org-title" className="font-heading text-xl font-semibold">
          {org.name}
        </h2>
        <OrgKindPill kind={org.kind} />
        {org.archived && (
          <span className="text-xs text-muted-foreground">Archived</span>
        )}
        <span className="flex-1" />
        <Button variant="outline" className="press" onClick={onEdit}>
          <PencilSimpleIcon />
          Edit
        </Button>
        <Button
          variant="ghost"
          className="press text-destructive"
          onClick={() => setConfirming(true)}
        >
          <TrashIcon />
          Delete
        </Button>
      </div>
      {confirming && (
        <div
          role="alertdialog"
          aria-labelledby="org-delete"
          className="flex flex-wrap items-center gap-2 bg-muted px-3 py-2"
        >
          <p id="org-delete" className="flex-1 text-sm">
            Delete {org.name}? Its{' '}
            {projects.length === 1
              ? 'project keeps'
              : `${projects.length} projects keep`}{' '}
            the name as text.
          </p>
          <Button
            variant="outline"
            className="press"
            autoFocus
            onClick={() => setConfirming(false)}
          >
            Keep it
          </Button>
          <Button variant="destructive" className="press" onClick={remove}>
            Delete
          </Button>
        </div>
      )}

      <section aria-labelledby="org-projects" className="flex flex-col gap-2">
        <h3 id="org-projects" className="font-heading text-sm font-semibold">
          Projects{' '}
          <span className="count font-sans text-xs font-normal text-muted-foreground tabular-nums">
            {projects.length}
          </span>
        </h3>
        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No projects yet. Pick this org in a project’s form.
          </p>
        ) : (
          <ul
            aria-label={`Projects of ${org.name}`}
            className="flex flex-col border-t"
          >
            {projects.map((p) => (
              <li
                key={p.id}
                className="row flex items-center gap-2 border-b text-sm"
              >
                <a
                  {...linkProps({ name: 'project', id: p.id })}
                  className="min-w-0 flex-1 truncate hover:underline hover:underline-offset-4"
                >
                  {p.name}
                  {p.archived && (
                    <span className="ml-1.5 text-muted-foreground">
                      (archived)
                    </span>
                  )}
                </a>
                <HealthBadge health={healthOf(p)} className="text-xs" />
                <StatusPill status={p.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="org-people" className="flex flex-col gap-2">
        <h3 id="org-people" className="font-heading text-sm font-semibold">
          Contacts
        </h3>
        {contacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No contacts. Add them with Edit.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {contacts.map((p) => (
              <li key={p.id}>
                <a
                  {...linkProps({ name: 'people', person: p.id })}
                  className="press flex min-h-11 items-center gap-2 border px-2 text-sm hover:bg-accent desk:min-h-8"
                >
                  <Initials person={p} />
                  {p.name}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="org-meetings" className="flex flex-col gap-2">
        <h3 id="org-meetings" className="font-heading text-sm font-semibold">
          Coming up
        </h3>
        {meetings.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing scheduled on its projects.
          </p>
        ) : (
          <ul className="flex flex-col border-t">
            {meetings.map((e) => (
              <li
                key={e.id}
                className="row flex items-center gap-3 border-b text-sm"
              >
                <span className="w-24 shrink-0 text-xs text-muted-foreground tabular-nums">
                  {formatDay(e.date, today)}
                </span>
                <a
                  {...linkProps({ name: 'meeting', id: e.id })}
                  className="min-w-0 flex-1 truncate hover:underline hover:underline-offset-4"
                >
                  {e.title}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(org.notes.trim() || org.links.length > 0) && (
        <section aria-labelledby="org-notes" className="flex flex-col gap-2">
          <h3 id="org-notes" className="font-heading text-sm font-semibold">
            Notes
          </h3>
          {org.notes.trim() && (
            <Markdown text={org.notes} people={state.people} />
          )}
          {org.links.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {org.links.map((l) => (
                <li key={l.url}>
                  <ExternalLink
                    url={l.url}
                    icon={false}
                    className="underline underline-offset-4"
                  >
                    {l.label || l.url}
                  </ExternalLink>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </article>
  );
}

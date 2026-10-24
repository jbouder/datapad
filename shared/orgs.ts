import { lastCall } from './select';
import type { Org, OrgKind, Project, Snapshot } from './types';

/**
 * Orgs as records (M7). A project's `org` text is still what shows and
 * what older exports carry; `orgId` links it to the record once orgs are
 * organised. Names are unique, ignoring case.
 */

const key = (name: string) => name.trim().toLowerCase();

/** The Org a name means, if there is one. */
export function orgByName(
  orgs: Snapshot['orgs'],
  name: string,
): Org | undefined {
  const k = key(name);
  return k ? Object.values(orgs).find((o) => key(o.name) === k) : undefined;
}

/** What a project's org is called: its Org's name, else its text. */
export function orgName(
  project: Pick<Project, 'org' | 'orgId'>,
  orgs: Snapshot['orgs'],
): string {
  return (project.orgId ? orgs[project.orgId]?.name : undefined) ?? project.org;
}

/** A first guess at what an org is to you, from its name. */
export function guessKind(name: string): OrgKind {
  return /\binternal\b/i.test(name) ? 'internal' : 'client';
}

/**
 * The orgs "Organise orgs" would make: each distinct project org text (and
 * the default org) with no Org yet, once each, with ids from `newId`.
 */
export function organizePlan(
  state: Pick<Snapshot, 'projects' | 'orgs' | 'settings'>,
  defaultOrg: string,
  newId: () => string,
): { id: string; name: string; kind: OrgKind }[] {
  const seen = new Set(Object.values(state.orgs).map((o) => key(o.name)));
  const plan: { id: string; name: string; kind: OrgKind }[] = [];
  const names = [
    ...Object.values(state.projects).map((p) => p.org),
    defaultOrg,
  ];
  for (const raw of names) {
    const name = raw.trim();
    if (!name || seen.has(key(name))) continue;
    seen.add(key(name));
    plan.push({ id: newId(), name, kind: guessKind(name) });
  }
  return plan.sort((a, b) => a.name.localeCompare(b.name));
}

/** How many projects still carry org text with no linked Org. */
export function unorganised(
  state: Pick<Snapshot, 'projects' | 'orgs'>,
): number {
  return Object.values(state.projects).filter(
    (p) => p.org.trim() && !(p.orgId && state.orgs[p.orgId]),
  ).length;
}

/** Each Org's projects, archived last then by name. */
export const orgProjects = lastCall(
  (
    projects: Snapshot['projects'],
    orgs: Snapshot['orgs'],
  ): Map<string, Project[]> => {
    const out = new Map<string, Project[]>();
    for (const p of Object.values(projects)) {
      const id =
        p.orgId && orgs[p.orgId] ? p.orgId : orgByName(orgs, p.org)?.id;
      if (!id) continue;
      const list = out.get(id) ?? [];
      list.push(p);
      out.set(id, list);
    }
    for (const list of out.values()) {
      list.sort(
        (a, b) =>
          Number(a.archived) - Number(b.archived) ||
          a.name.localeCompare(b.name),
      );
    }
    return out;
  },
);

import { LIMITS } from './limits';
import { byDate } from './milestones';
import type { Milestone } from './types';

/**
 * Events became meetings, and milestones moved onto their project. This
 * brings a snapshot or an export file written before that (a collection
 * called `events`, notes with `eventId`) to the current shape, so that
 * `ExportSchema` (and with it `merge()`, Import and restoring a backup) and
 * the Durable Object only ever see the new one. Pure, and it never changes
 * its input. The rules:
 *
 * - An event of type `meeting`, `demo` or `other` (or none) is a meeting:
 *   the same document without `type`, under the same id.
 * - A `milestone` or `deadline` on a project becomes a milestone on that
 *   project (same id, title and date) and the event goes. Notes linked to
 *   it keep their body and lose the link (`meetingId` and `phase` null).
 * - A `milestone` or `deadline` in General, or whose project is not in
 *   the same file, or whose project already has `LIMITS.milestonesMax`,
 *   stays a meeting so nothing is lost, titled `Milestone: …` or
 *   `Deadline: …`.
 * - A note's `eventId` is its `meetingId`.
 * - Activity keeps its text: history is history.
 *
 * A file already in the new shape comes back as the same object.
 */

type Doc = Record<string, unknown>;

const PREFIX: Record<string, string> = {
  milestone: 'Milestone: ',
  deadline: 'Deadline: ',
};

function isDoc(value: unknown): value is Doc {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A collection's documents with their ids, whichever shape it has (a map
 * by id, or an array of documents carrying `id`), as `ExportSchema` reads
 * them. Anything that is not a document is skipped here; the schema will
 * say what is wrong with it.
 */
function documents(value: unknown): Array<[string, Doc]> {
  const out: Array<[string, Doc]> = [];
  if (Array.isArray(value)) {
    for (const doc of value) {
      if (isDoc(doc) && typeof doc.id === 'string') out.push([doc.id, doc]);
    }
  } else if (isDoc(value)) {
    for (const [key, doc] of Object.entries(value)) {
      if (isDoc(doc)) {
        out.push([key, { id: key, ...doc }]);
      }
    }
  }
  return out;
}

/** The same collection with each document mapped, in its own shape. */
function mapDocuments(value: unknown, fn: (doc: Doc, id: string) => Doc) {
  if (Array.isArray(value)) {
    return value.map((doc) =>
      isDoc(doc) ? fn(doc, typeof doc.id === 'string' ? doc.id : '') : doc,
    );
  }
  if (isDoc(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, doc]) => [
        key,
        isDoc(doc) ? fn(doc, typeof doc.id === 'string' ? doc.id : key) : doc,
      ]),
    );
  }
  return value;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Whether `input` still has anything from before meetings. */
export function isLegacy(input: unknown): boolean {
  if (!isDoc(input)) return false;
  if ('events' in input) return true;
  return documents(input.notes).some(([, n]) => 'eventId' in n);
}

/** `input` in the current shape (see above); anything else unchanged. */
export function migrate(input: unknown): unknown {
  if (!isDoc(input) || !isLegacy(input)) return input;
  const { events, ...rest } = input;

  const projectIds = new Set(documents(input.projects).map(([id]) => id));
  const room = new Map<string, number>();
  for (const [id, p] of documents(input.projects)) {
    const had = Array.isArray(p.milestones) ? p.milestones.length : 0;
    room.set(id, LIMITS.milestonesMax - had);
  }

  const milestones = new Map<string, Milestone[]>();
  /** Event ids that became milestones: their notes lose the link. */
  const gone = new Set<string>();
  const meetings: Record<string, Doc> = {};

  for (const [id, event] of documents(events)) {
    const { type, ...meeting } = event;
    const prefix = typeof type === 'string' ? PREFIX[type] : undefined;
    if (!prefix) {
      meetings[id] = meeting;
      continue;
    }
    const projectId = event.projectId;
    if (
      typeof projectId === 'string' &&
      projectIds.has(projectId) &&
      (room.get(projectId) ?? 0) > 0
    ) {
      room.set(projectId, (room.get(projectId) ?? 0) - 1);
      const list = milestones.get(projectId) ?? [];
      list.push({
        id,
        title: String(event.title ?? ''),
        date: String(event.date ?? ''),
      });
      milestones.set(projectId, list);
      gone.add(id);
      continue;
    }
    meetings[id] = {
      ...meeting,
      title: clip(`${prefix}${String(event.title ?? '')}`, LIMITS.titleMax),
    };
  }

  const out: Doc = { ...rest };
  if (events !== undefined || 'meetings' in input) {
    out.meetings = {
      ...meetings,
      ...Object.fromEntries(documents(input.meetings)),
    };
  }
  if (milestones.size > 0) {
    out.projects = mapDocuments(input.projects, (p, id) => {
      const added = milestones.get(id);
      if (!added) return p;
      const had = Array.isArray(p.milestones)
        ? (p.milestones as Milestone[])
        : [];
      return { ...p, milestones: [...had, ...added].sort(byDate) };
    });
  }
  if ('notes' in input) {
    out.notes = mapDocuments(input.notes, (n) => {
      if (!('eventId' in n)) return n;
      const { eventId, ...note } = n;
      const linked = note.meetingId ?? eventId ?? null;
      if (typeof linked === 'string' && gone.has(linked)) {
        return { ...note, meetingId: null, phase: null };
      }
      return { ...note, meetingId: linked };
    });
  }
  return out;
}

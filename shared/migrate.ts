import { LIMITS } from './limits';
import { byDate } from './milestones';
import type { Milestone } from './types';

/**
 * Two migrations: `migrate()` (meetings, below) and `migrateFormat3()`
 * (to decide, lists and the Notepad, at the end of this file).
 *
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

/**
 * Format 3 (#328): "to decide" is a field, lists are checklist notes and
 * the Notepad is an ordinary note. This brings a snapshot or a format 1
 * or 2 export file up to it; Import runs it on those files, and the
 * Durable Object on each space at schema 4. Pure, and it never changes
 * its input. The rules:
 *
 * - An open task tagged `decide` gets `decide: true`. The tag is kept.
 * - Each list becomes a note on the same project (or General), under the
 *   list's own id: `## <title>`, then one `- [ ]` or `- [x]` line per
 *   item, in order. It keeps the list's `createdAt` and takes `editedAt`
 *   from its `updatedAt`. A list too long for one note goes on in more,
 *   `<id>-2`, `<id>-3` …, each under the same heading. The list itself is
 *   kept, as decisions were (#183).
 * - The Notepad (a note with `scratch`) loses the mark.
 *
 * A note already under a list's id is left as it is, so running it again
 * changes nothing; a file already in this shape comes back as the same
 * object.
 */
export function migrateFormat3(input: unknown): unknown {
  if (!isDoc(input)) return input;
  const out: Doc = { ...input };
  let changed = false;

  if (documents(input.tasks).some(([, t]) => toDecide(t))) {
    out.tasks = mapDocuments(input.tasks, (t) =>
      toDecide(t) ? { ...t, decide: true } : t,
    );
    changed = true;
  }

  const taken = new Set(documents(input.notes).map(([id]) => id));
  const added: Doc[] = [];
  for (const [id, list] of documents(input.lists)) {
    for (const note of listNotes(id, list)) {
      const noteId = note.id as string;
      if (taken.has(noteId)) continue;
      taken.add(noteId);
      added.push(note);
    }
  }
  const scratch = documents(input.notes).some(([, n]) => 'scratch' in n);
  if (added.length > 0 || scratch) {
    const cleared = scratch
      ? mapDocuments(input.notes, (n) => {
          if (!('scratch' in n)) return n;
          const { scratch: _, ...note } = n;
          return note;
        })
      : (input.notes ?? {});
    out.notes = Array.isArray(cleared)
      ? [...cleared, ...added]
      : {
          ...(isDoc(cleared) ? cleared : {}),
          ...Object.fromEntries(added.map((n) => [n.id as string, n])),
        };
    changed = true;
  }
  return changed ? out : input;
}

/** An open task tagged `decide` that is not yet marked to decide. */
function toDecide(task: Doc): boolean {
  return (
    task.decide !== true &&
    (task.status ?? 'open') === 'open' &&
    Array.isArray(task.tags) &&
    task.tags.some((t) => typeof t === 'string' && t.toLowerCase() === 'decide')
  );
}

/** One line: newlines and runs of space folded to a single space. */
function line(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A list's checklist note (or notes, when it is too long for one). */
function listNotes(id: string, list: Doc): Doc[] {
  const heading = `## ${line(list.title)}`;
  const items = Array.isArray(list.items) ? list.items.filter(isDoc) : [];
  const bodies: string[] = [];
  let body = heading;
  for (const i of items) {
    const next = `- [${i.done === true ? 'x' : ' '}] ${line(i.text)}`;
    if (body !== heading && body.length + 1 + next.length > LIMITS.bodyMax) {
      bodies.push(body);
      body = heading;
    }
    body += `\n${next}`;
  }
  bodies.push(body);
  const createdAt = String(list.createdAt ?? '');
  const editedAt = String(list.updatedAt ?? createdAt);
  return bodies.map((b, n) => ({
    id: n === 0 ? id : partId(id, n + 1),
    projectId: typeof list.projectId === 'string' ? list.projectId : null,
    body: b,
    pinned: false,
    meetingId: null,
    phase: null,
    createdAt,
    editedAt,
  }));
}

/** The id of a long list's `n`th note: `<id>-<n>`, within `idMax`. */
function partId(id: string, n: number): string {
  const suffix = `-${n}`;
  return `${id.slice(0, LIMITS.idMax - suffix.length)}${suffix}`;
}

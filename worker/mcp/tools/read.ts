import { z } from 'zod';
import { tokensToNames } from '#shared/mentions';
import { orgName } from '#shared/orgs';
import { zonedDay } from '#shared/schedule';
import {
  blockedOf,
  type DateString,
  type Meeting,
  type Note,
  type Snapshot,
  type Task,
  topicsOf,
} from '#shared/types';
import { type McpToolContext, requireSpace, ToolError } from '../tool';

/**
 * What every read tool (#153) shares: one space's snapshot, "today", the
 * id-or-name rule, the result cap, and how documents read out (mentions
 * as `@Name`, people and projects by id and name). The selection itself is
 * always `shared/`'s, never redone here.
 */

/** The most items any one list in a result carries. */
export const MAX_ITEMS = 200;

/** One space's state, read once per call. */
export interface SpaceRead {
  space: string;
  state: Snapshot;
  today: DateString;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const DayArg = z.string().regex(DAY, 'A date as YYYY-MM-DD');

export const TodayArg = DayArg.optional().describe(
  "The day to count from, YYYY-MM-DD. Defaults to today in the owner's zone.",
);

export const LimitArg = z
  .number()
  .int()
  .min(1)
  .max(MAX_ITEMS)
  .optional()
  .describe(`At most this many items (1–${MAX_ITEMS}).`);

/** Resolve the space, read its snapshot, and settle on today. */
export async function readSpace(
  ctx: McpToolContext,
  asked: string | undefined,
  today?: DateString,
): Promise<SpaceRead> {
  const space = await requireSpace(ctx, asked);
  const { state } = await ctx.datapad.snapshot(space);
  return {
    space,
    state,
    today: today ?? zonedDay(Date.now(), ctx.timeZone),
  };
}

/** A list cut to `limit`, saying how many there were and whether it was cut. */
export interface Capped<T> {
  count: number;
  truncated: boolean;
  items: T[];
}

export function cap<T>(list: readonly T[], limit = MAX_ITEMS): Capped<T> {
  const n = Math.min(limit, MAX_ITEMS);
  return {
    count: list.length,
    truncated: list.length > n,
    items: list.slice(0, n),
  };
}

/* ---- Names to ids --------------------------------------------------------- */

const key = (text: string) => text.trim().toLowerCase();

/**
 * The record `asked` means: its id, else the one name equal to it ignoring
 * case, else the one name containing it. Two or more equal names, or no
 * equal name and two or more containing it, is a `ToolError` listing the
 * candidates (up to ten) so the caller can pick an id; never a guess.
 */
export function resolveByName<T extends { id: string }>(
  records: Record<string, T>,
  asked: string,
  what: string,
  nameOf: (record: T) => string,
  label: (record: T) => string = nameOf,
): T {
  const byId = records[asked];
  if (byId) return byId;
  const k = key(asked);
  const all = Object.values(records);
  const equal = all.filter((r) => key(nameOf(r)) === k);
  const found =
    equal.length > 0
      ? equal
      : k
        ? all.filter((r) => key(nameOf(r)).includes(k))
        : [];
  if (found.length === 1 && found[0]) return found[0];
  if (found.length === 0) {
    throw new ToolError(`No ${what} matches "${asked}".`);
  }
  const listed = found
    .slice(0, 10)
    .map((r) => `${r.id} (${label(r)})`)
    .join('; ');
  throw new ToolError(
    `"${asked}" matches ${found.length} ${what}s; pass one of these ids: ${listed}.`,
  );
}

/** `general` for General (no project), else a project by id or name. */
export const ProjectArg = z
  .string()
  .min(1)
  .max(200)
  .describe('A project id or name (ignoring case), or "general" for General.');

export function resolveProject(state: Snapshot, asked: string): string | null {
  if (key(asked) === 'general' && !state.projects[asked]) return null;
  return resolveByName(state.projects, asked, 'project', (p) => p.name).id;
}

export const PersonArg = z
  .string()
  .min(1)
  .max(200)
  .describe('A person id or name (ignoring case).');

export function resolvePerson(state: Snapshot, asked: string): string {
  return resolveByName(state.people, asked, 'person', (p) => p.name).id;
}

export function resolveOrg(state: Snapshot, asked: string): string {
  return resolveByName(state.orgs, asked, 'org', (o) => o.name).id;
}

export const MeetingArg = z
  .string()
  .min(1)
  .max(200)
  .describe('A meeting id or title (ignoring case).');

export function resolveMeeting(state: Snapshot, asked: string): string {
  return resolveByName(
    state.meetings,
    asked,
    'meeting',
    (m) => m.title,
    (m) => `${m.title}, ${m.date}`,
  ).id;
}

/* ---- How documents read out ---------------------------------------------- */

export interface Ref {
  id: string;
  name: string;
}

/** Text with every `@{id}` as `@Name`. */
export function text(state: Snapshot, body: string): string {
  return tokensToNames(body, state.people);
}

export function projectRef(state: Snapshot, id: string | null): Ref | null {
  const p = id ? state.projects[id] : undefined;
  return p ? { id: p.id, name: p.name } : null;
}

export function personRef(state: Snapshot, id: string | null): Ref | null {
  const p = id ? state.people[id] : undefined;
  return p ? { id: p.id, name: p.name } : null;
}

export function peopleRefs(state: Snapshot, ids: readonly string[]): Ref[] {
  return ids.flatMap((id) => personRef(state, id) ?? []);
}

export function projectOrg(state: Snapshot, id: string): string {
  const p = state.projects[id];
  return p ? orgName(p, state.orgs) : '';
}

export function taskOut(state: Snapshot, t: Task) {
  const blocked = blockedOf(t);
  const meeting = t.meetingId ? state.meetings[t.meetingId] : undefined;
  return {
    id: t.id,
    title: t.title,
    project: projectRef(state, t.projectId),
    status: t.status,
    priority: t.priority,
    due: t.due,
    assignee: personRef(state, t.assignee || null),
    blocked: blocked
      ? { on: personRef(state, blocked.on), note: blocked.note }
      : null,
    tags: t.tags,
    desc: text(state, t.desc),
    meeting: meeting
      ? { id: meeting.id, title: meeting.title, date: meeting.date }
      : null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    completedAt: t.completedAt,
  };
}

export function noteOut(state: Snapshot, n: Note) {
  const meeting = n.meetingId ? state.meetings[n.meetingId] : undefined;
  const task = n.taskId ? state.tasks[n.taskId] : undefined;
  return {
    id: n.id,
    project: projectRef(state, n.projectId),
    meeting: meeting
      ? { id: meeting.id, title: meeting.title, date: meeting.date }
      : null,
    task: task ? { id: task.id, title: task.title } : null,
    pinned: n.pinned,
    // The space's Notepad (#218), its running General note.
    ...(n.scratch ? { notepad: true } : {}),
    body: text(state, n.body),
    createdAt: n.createdAt,
    editedAt: n.editedAt ?? null,
  };
}

export function meetingOut(state: Snapshot, m: Meeting) {
  return {
    id: m.id,
    title: m.title,
    project: projectRef(state, m.projectId),
    date: m.date,
    time: m.time,
    end: m.end,
    attendees: peopleRefs(state, m.attendees),
    link: m.link,
    note: m.note,
    topics: topicsOf(m).map((t) => ({
      id: t.id,
      title: t.title,
      done: t.done,
      outcome: t.outcome,
      carriedFrom: t.carriedFrom ?? null,
    })),
  };
}

import { z } from 'zod';
import { parseDate } from '#shared/dates';
import { newId } from '#shared/ids';
import { LIMITS } from '#shared/limits';
import { namesToTokens } from '#shared/mentions';
import { orgName } from '#shared/orgs';
import type { BaseOp } from '#shared/protocol';
import { meId } from '#shared/select';
import {
  type DateString,
  healthOf,
  milestonesOf,
  type Project,
  type Snapshot,
  type Task,
  type Topic,
  topicsOf,
} from '#shared/types';
import { type McpToolContext, ToolError } from '../tool';
import {
  PersonArg,
  peopleRefs,
  projectRef,
  resolveByName,
  resolvePerson,
  text,
} from './read';

/**
 * What every write tool (#154) shares. A write tool reads the space,
 * turns names into ids and words into dates, builds one op (or a small
 * batch) with ids made here (`shared/ids`), and hands it to the Durable
 * Object's `apply()`, which runs it through `OpSchema` and `reduce()` and
 * sends it to every open tab, exactly as an op from the app. Nothing here
 * changes state any other way, and nothing here deletes.
 */

/** An activity line a write produced, with its project by id and name. */
export interface ActivityOut {
  /** null: General's log. */
  project: { id: string; name: string } | null;
  text: string;
}

export interface Written {
  /** The space after the change. */
  state: Snapshot;
  /** When it was applied (the object's clock); null for a retry. */
  at: string | null;
  /** True when this `requestId` had already landed: nothing changed now. */
  replay: boolean;
  activity: ActivityOut[];
}

/* ---- Retries (#244) ------------------------------------------------------- */

/**
 * The caller's name for one change. A tool given one makes the op id and
 * any new document's id from it, so calling again with the same one (a
 * retry after a timeout, say) changes nothing twice: the object has
 * already seen the op id, and the tool answers with the document as it
 * is. Its own namespace (`mcp-…`) keeps it off the app's op ids.
 */
export const RequestIdArg = z
  .string()
  .regex(
    /^[A-Za-z0-9_-]{8,60}$/,
    'A requestId is 8 to 60 letters, digits, - or _ (a UUID will do)',
  )
  .optional()
  .describe(
    'Optional, for retries: a fresh id for this change (a UUID will do). Calling again with the same requestId does not repeat the change; it returns what the first call made. Use a new one for every new change.',
  );

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const encoder = new TextEncoder();

/** The op id for a change: from the `requestId`, or a new one. */
export function opIdFor(requestId: string | undefined): string {
  return requestId ? `mcp-${requestId}` : newId();
}

/**
 * A new document's id: random, or with a `requestId` the same on every
 * retry (16 base-36 characters from its SHA-256, like `newId()`'s).
 */
export async function docId(requestId: string | undefined): Promise<string> {
  if (!requestId) return newId();
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      encoder.encode(`datapad-mcp-doc:${requestId}`),
    ),
  );
  return Array.from(digest.slice(0, 16), (b) => ALPHABET[b % 36]).join('');
}

/** Whether what `op` creates is in `state`: a replay of it landed here. */
function landed(state: Snapshot, op: BaseOp): boolean {
  switch (op.type) {
    case 'addTask':
      return Boolean(state.tasks[op.id]);
    case 'addNote':
      return Boolean(state.notes[op.id]);
    case 'addMeeting':
      return Boolean(state.meetings[op.id]);
    case 'createProject':
      return Boolean(state.projects[op.id]);
    case 'addMilestone': {
      const p = state.projects[op.projectId];
      return Boolean(p && milestonesOf(p).some((m) => m.id === op.id));
    }
    case 'addTopic': {
      const m = state.meetings[op.meetingId];
      return Boolean(m && topicsOf(m).some((t) => t.id === op.id));
    }
    default:
      return true;
  }
}

/**
 * Apply `ops` to `space` as one change, through the object's `apply()`,
 * under the op id `requestId` makes (or a new one). A refusal (the
 * schema's or the reducer's) is a `ToolError` with the reason, for the
 * model to read and fix; so is a `requestId` already spent on a
 * different change.
 */
export async function write(
  ctx: McpToolContext,
  space: string,
  ops: BaseOp[],
  requestId?: string,
): Promise<Written> {
  const outcome = await ctx.datapad.apply(space, opIdFor(requestId), ops);
  if (!outcome.ok) {
    throw new ToolError(`Not saved: ${outcome.error}.`);
  }
  const { state } = outcome;
  if (outcome.replay && !ops.every((op) => landed(state, op))) {
    throw new ToolError(
      `Not saved: requestId "${requestId}" was already used for a different change. Use a new requestId for each new change, and the same one only to retry.`,
    );
  }
  return {
    state,
    at: outcome.at,
    replay: outcome.replay,
    activity: outcome.activity.map((line) => ({
      project: projectRef(state, line.project),
      text: line.text,
    })),
  };
}

/* ---- Arguments ------------------------------------------------------------ */

/** A day as words or digits, read with `shared/dates`' `parseDate`. */
export const DayText = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .describe(
    'A day: YYYY-MM-DD, or words relative to today such as "today", "tomorrow", "fri", "next fri", "next week", "+3d", "2w", "10/31".',
  );

/** The same, where "none" (or "") clears the date. */
export const DayOrNoneText = z
  .string()
  .trim()
  .max(40)
  .describe(
    'A day as YYYY-MM-DD or words ("tomorrow", "fri", "+3d"); "none" or "" clears it.',
  );

/** `text` as a day, relative to `today`; a `ToolError` when it is not one. */
export function day(
  input: string,
  today: DateString,
  what: string,
): DateString | '' {
  const k = input.trim().toLowerCase();
  if (k === '' || k === 'none') return '';
  const parsed = parseDate(input, today);
  if (parsed === null) {
    throw new ToolError(
      `"${input}" is not a day ${what} can be. Use YYYY-MM-DD, or words like "tomorrow" or "fri".`,
    );
  }
  return parsed;
}

/** `day()` where a day is required. */
export function requiredDay(
  input: string,
  today: DateString,
  what: string,
): DateString {
  const parsed = day(input, today, what);
  if (parsed === '') throw new ToolError(`${what} needs a day.`);
  return parsed;
}

export const TitleArg = z.string().trim().min(1).max(LIMITS.titleMax);

export const MarkdownArg = z
  .string()
  .max(LIMITS.bodyMax)
  .describe(
    'Markdown. Write mentions as @Name (a person in list_people); they are stored as links to the person.',
  );

export const TagsArg = z
  .array(z.string().trim().min(1).max(LIMITS.tagMax))
  .max(LIMITS.tagsMax)
  .describe('Tags, without the #.');

export const TaskArg = z
  .string()
  .min(1)
  .max(LIMITS.titleMax)
  .describe(
    'A task id, or its title (ignoring case, or a unique part of it). Ids from list_tasks are safest.',
  );

export const AssigneeArg = PersonArg.describe(
  'A person id or name (ignoring case), "me" for the person marked as you, or "unassigned".',
);

/** `@Name` mentions as the `@{id}` tokens the app stores. */
export function tokens(state: Snapshot, markdown: string): string {
  return namesToTokens(markdown, state.people);
}

/** A task by id or title. */
export function resolveTask(state: Snapshot, asked: string): Task {
  return resolveByName(
    state.tasks,
    asked,
    'task',
    (t) => t.title,
    (t) =>
      `${t.title}, ${t.status}${t.projectId ? ` in ${state.projects[t.projectId]?.name ?? 'a project'}` : ''}`,
  );
}

/** The assignee an argument means: a person id, or '' for nobody. */
export function resolveAssignee(state: Snapshot, asked: string): string {
  const word = asked.trim().toLowerCase();
  if (word === '' || word === 'unassigned' || word === 'nobody') return '';
  if (word === 'me' || word === 'mine') {
    const me = meId(state.people);
    if (!me) {
      throw new ToolError(
        'Nobody is marked as you in People, so "me" matches no one. Name the person instead.',
      );
    }
    return me;
  }
  return resolvePerson(state, asked);
}

/** People by id or name, each once, in the order given. */
export function resolvePeople(state: Snapshot, asked: string[]): string[] {
  return [...new Set(asked.map((name) => resolvePerson(state, name)))];
}

/** A project, required: General is not one here. */
export function resolveRealProject(state: Snapshot, asked: string): Project {
  if (asked.trim().toLowerCase() === 'general' && !state.projects[asked]) {
    throw new ToolError('General is not a project; name a project.');
  }
  return resolveByName(state.projects, asked, 'project', (p) => p.name);
}

/** A topic of a meeting by id or title. */
export function resolveTopic(topics: readonly Topic[], asked: string): Topic {
  const byId = Object.fromEntries(topics.map((t) => [t.id, t]));
  return resolveByName(byId, asked, 'topic', (t) => t.title);
}

/** A project as a write tool reports it. */
export function projectOut(state: Snapshot, p: Project) {
  return {
    id: p.id,
    name: p.name,
    org: orgName(p, state.orgs),
    status: p.status,
    health: healthOf(p),
    priority: p.priority,
    startDate: p.startDate ?? '',
    targetDate: p.targetDate,
    tags: p.tags,
    desc: text(state, p.desc),
    members: peopleRefs(state, p.members),
    milestones: milestonesOf(p),
    archived: p.archived,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/** A meeting's topic, once the write has landed. */
export function topicOf(state: Snapshot, meetingId: string, topicId: string) {
  const m = state.meetings[meetingId];
  const t = m ? topicsOf(m).find((x) => x.id === topicId) : undefined;
  if (!m || !t) throw new ToolError('That topic is gone.');
  return t;
}

export { newId };

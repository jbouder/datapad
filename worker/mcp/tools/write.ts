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
  /** When it was applied (the object's clock). */
  at: string | null;
  activity: ActivityOut[];
}

/**
 * Apply `ops` to `space` as one change, through the object's `apply()`.
 * A refusal (the schema's or the reducer's) is a `ToolError` with the
 * reason, for the model to read and fix.
 */
export async function write(
  ctx: McpToolContext,
  space: string,
  ops: BaseOp[],
): Promise<Written> {
  const outcome = await ctx.datapad.apply(space, newId(), ops);
  if (!outcome.ok) {
    throw new ToolError(`Not saved: ${outcome.error}.`);
  }
  const { state } = outcome;
  return {
    state,
    at: outcome.at,
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

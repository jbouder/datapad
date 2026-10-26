import { formatDay } from './dates';
import { buildDigest, digestMarkdown, weekEnding } from './digest';
import { byWhen, timeRange } from './meetings';
import { tokensToNames } from './mentions';
import {
  blockedOf,
  healthOf,
  type Meeting,
  milestonesOf,
  type Note,
  type Snapshot,
  type Task,
} from './types';

/**
 * What Summarize tells the on-device model (docs/SPEC.md § Claude
 * summaries): the system prompt, and per item a plain-text context of
 * labeled sections, mentions as names, nothing from outside the item.
 * Pure, so it is tested without a GPU; the model itself lives behind
 * `src/lib/summary-engine.ts`.
 */

export interface SummaryModel {
  /** A `model_id` from WebLLM's prebuilt list. */
  id: string;
  name: string;
  /** Weights plus runtime, as the owner sees it before agreeing. */
  downloadLabel: string;
  /** GPU memory it needs once loaded. */
  vramLabel: string;
  /** Who it suits, in one line. */
  note: string;
}

/** Where the weights come from; nothing in Datapad is ever sent there. */
export const MODEL_SOURCE = 'Hugging Face';

/**
 * Holocron's `ANALYSIS_MODELS`, the same ids and sizes, smallest first.
 * All are 4-bit Qwen3 builds; the sizes are WebLLM's own figures, rounded.
 */
export const SUMMARY_MODELS: readonly SummaryModel[] = [
  {
    id: 'Qwen3-1.7B-q4f16_1-MLC',
    name: 'Qwen3 1.7B',
    downloadLabel: 'about 1 GB',
    vramLabel: '2 GB',
    note: 'Quick, and good enough for most items. Runs on most laptops.',
  },
  {
    id: 'Qwen3-4B-q4f16_1-MLC',
    name: 'Qwen3 4B',
    downloadLabel: 'about 2.4 GB',
    vramLabel: '3.5 GB',
    note: 'Sharper summaries of big projects. Slower on integrated graphics.',
  },
  {
    id: 'Qwen3-8B-q4f16_1-MLC',
    name: 'Qwen3 8B',
    downloadLabel: 'about 4.6 GB',
    vramLabel: '6 GB',
    note: 'Needs a discrete GPU, or a Mac with 16 GB of memory or more.',
  },
];

export const DEFAULT_MODEL = SUMMARY_MODELS[0];

/** The model for a stored choice; the default when it is unknown or stale. */
export function findModel(id: string | null | undefined): SummaryModel {
  return SUMMARY_MODELS.find((m) => m.id === id) ?? DEFAULT_MODEL;
}

/** Holocron's request settings, streamed as Markdown instead of JSON. */
export const REQUEST_SETTINGS = {
  temperature: 0.3,
  max_tokens: 900,
  // Qwen3 would otherwise spend its budget on a <think> block first.
  extra_body: { enable_thinking: false },
} as const;

/** The spec's prompt, word for word. The context follows it. */
export const SYSTEM_PROMPT =
  'You are summarizing one item from a personal project tracker used by an engineering leader. Write a concise summary in plain markdown using short paragraphs and "- " bullets (headings, if any, as "### "). Structure: a 1–3 sentence overview; then bullets for key points; then "Open items" and "Suggested next steps" when the data supports them. Be specific, keep names and dates, do not invent anything not in the data, and stay under 220 words.';

/** How much of a project goes in (docs/SPEC.md § Claude summaries). */
export const SUMMARY_LIMITS = {
  doneTasks: 15,
  notes: 20,
  activity: 25,
  decisions: 10,
} as const;

const PHASE_TAG = { pre: '[prep]', post: '[debrief]' } as const;

const PRIORITY_WORDS = {
  none: 'none',
  low: 'low',
  med: 'medium',
  high: 'high',
} as const;

type Lookup = Pick<Snapshot, 'projects' | 'people'>;

function projectName(state: Lookup, id: string | null): string {
  return id ? (state.projects[id]?.name ?? 'General') : 'General';
}

function personName(state: Lookup, id: string): string | undefined {
  return id ? state.people[id]?.name : undefined;
}

function names(state: Lookup, ids: string[]): string {
  return ids
    .map((id) => state.people[id]?.name)
    .filter(Boolean)
    .join(', ');
}

function day(date: string): string {
  return formatDay(date, '0000-01-01');
}

function noteTag(note: Note): string {
  return note.phase ? PHASE_TAG[note.phase] : '[note]';
}

function noteDay(note: Note): string {
  return day(note.createdAt.slice(0, 10));
}

/**
 * A meeting: title, date and times, project, attendees, agenda, and every
 * linked note, oldest first, labeled `[prep]`, `[debrief]` or `[note]`.
 */
export function meetingContext(
  meeting: Meeting,
  state: Pick<Snapshot, 'projects' | 'people' | 'notes'>,
): string {
  const attendees = names(state, meeting.attendees);
  const range = timeRange(meeting);
  const lines = [
    `Meeting: ${meeting.title}`,
    `Date: ${day(meeting.date)}${range ? `, ${range}` : ''}`,
    `Project: ${projectName(state, meeting.projectId)}`,
    `Attendees: ${attendees || 'none listed'}`,
  ];
  if (meeting.note) lines.push(`Agenda: ${meeting.note}`);

  const notes = Object.values(state.notes)
    .filter((n) => n.meetingId === meeting.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (notes.length > 0) {
    lines.push('', 'Linked notes:');
    for (const n of notes) {
      lines.push(
        `${noteTag(n)} ${noteDay(n)}`,
        tokensToNames(n.body, state.people).trim(),
        '',
      );
    }
  }
  return lines.join('\n').trimEnd();
}

/** One task line for a project's lists: title, then what is set. */
function taskLine(task: Task, state: Lookup): string {
  const bits = [`- ${task.title}`];
  if (task.priority !== 'none')
    bits.push(`priority ${PRIORITY_WORDS[task.priority]}`);
  if (task.due) bits.push(`due ${day(task.due)}`);
  const assignee = personName(state, task.assignee);
  if (assignee) bits.push(`assigned to ${assignee}`);
  if (task.completedAt)
    bits.push(`closed ${day(task.completedAt.slice(0, 10))}`);
  const waiting = blockedLine(task, state);
  if (waiting) bits.push(waiting);
  return bits.join(', ');
}

/** "blocked on Han Solo: needs the parts" */
function blockedLine(task: Task, state: Lookup): string {
  const b = blockedOf(task);
  if (!b) return '';
  const who = b.on ? personName(state, b.on) : undefined;
  return `blocked${who ? ` on ${who}` : ''}${b.note ? `: ${b.note}` : ''}`;
}

function indent(text: string): string {
  return text
    .trim()
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

/**
 * A project: its fields, open tasks with their details, the last 15 done
 * tasks, every milestone, every meeting, the last 20 notes newest first,
 * the last 25
 * activity lines.
 */
export function projectContext(projectId: string, state: Snapshot): string {
  const project = state.projects[projectId];
  if (!project) return '';
  const lines = [
    `Project: ${project.name}`,
    `Org: ${project.org || 'none'}`,
    `Status: ${project.status}`,
    `Health: ${healthOf(project) === 'none' ? 'not set' : healthOf(project)}`,
    `Priority: ${PRIORITY_WORDS[project.priority]}`,
    `Start date: ${project.startDate ? day(project.startDate) : 'none'}`,
    `Target date: ${project.targetDate ? day(project.targetDate) : 'none'}`,
    `Team: ${names(state, project.members) || 'none listed'}`,
  ];
  if (project.state) lines.push(`Current state: ${project.state}`);
  if (project.desc.trim()) {
    lines.push(
      'Description:',
      tokensToNames(project.desc, state.people).trim(),
    );
  }

  const tasks = Object.values(state.tasks).filter(
    (t) => t.projectId === projectId,
  );
  const open = tasks
    .filter((t) => t.status === 'open')
    .sort((a, b) => a.order - b.order);
  const done = tasks
    .filter((t) => t.status === 'done')
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
    .slice(0, SUMMARY_LIMITS.doneTasks);
  lines.push('', `Open tasks (${open.length}):`);
  if (open.length === 0) lines.push('none');
  for (const t of open) {
    lines.push(taskLine(t, state));
    if (t.desc.trim()) lines.push(indent(tokensToNames(t.desc, state.people)));
  }
  if (done.length > 0) {
    lines.push('', 'Recently done tasks:');
    for (const t of done) lines.push(taskLine(t, state));
  }

  const milestones = milestonesOf(project);
  if (milestones.length > 0) {
    lines.push('', 'Milestones:');
    for (const m of milestones) lines.push(`- ${day(m.date)}: ${m.title}`);
  }

  const meetings = Object.values(state.meetings)
    .filter((m) => m.projectId === projectId)
    .sort(byWhen);
  if (meetings.length > 0) {
    lines.push('', 'Meetings:');
    for (const m of meetings) {
      const range = timeRange(m);
      lines.push(`- ${day(m.date)}${range ? ` ${range}` : ''}: ${m.title}`);
    }
  }

  const notes = Object.values(state.notes)
    .filter((n) => n.projectId === projectId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, SUMMARY_LIMITS.notes);
  if (notes.length > 0) {
    lines.push('', 'Notes, newest first:');
    for (const n of notes) {
      lines.push(
        `${noteTag(n)} ${noteDay(n)}`,
        tokensToNames(n.body, state.people).trim(),
        '',
      );
    }
    lines.pop();
  }

  const decisions = Object.values(state.decisions ?? {})
    .filter((x) => x.projectId === projectId)
    .sort((a, b) =>
      (b.decidedAt || b.createdAt).localeCompare(a.decidedAt || a.createdAt),
    )
    .slice(0, SUMMARY_LIMITS.decisions);
  if (decisions.length > 0) {
    lines.push('', 'Decisions, newest first:');
    for (const x of decisions) {
      const when = x.decidedAt ? ` ${day(x.decidedAt)}` : '';
      const by = names(state, x.deciders);
      lines.push(`- [${x.status}${when}] ${x.title}${by ? ` (${by})` : ''}`);
      if (x.rationale.trim()) {
        lines.push(indent(tokensToNames(x.rationale, state.people)));
      }
    }
  }

  const activity = (state.activity[projectId]?.events ?? []).slice(
    0,
    SUMMARY_LIMITS.activity,
  );
  if (activity.length > 0) {
    lines.push('', 'Recent activity, newest first:');
    for (const a of activity) {
      lines.push(`- ${day(a.t.slice(0, 10))}: ${a.text}`);
    }
  }
  return lines.join('\n').trimEnd();
}

/**
 * A task: its fields, details, link labels, and the note it was made
 * from, if any.
 */
export function taskContext(
  task: Task,
  state: Pick<Snapshot, 'projects' | 'people' | 'notes'>,
): string {
  const lines = [
    `Task: ${task.title}`,
    `Project: ${projectName(state, task.projectId)}`,
    `Status: ${task.status}`,
    `Priority: ${PRIORITY_WORDS[task.priority]}`,
    `Due: ${task.due ? day(task.due) : 'none'}`,
    `Assignee: ${personName(state, task.assignee) ?? 'unassigned'}`,
  ];
  const waiting = blockedLine(task, state);
  if (waiting) lines.push(`Waiting: ${waiting}`);
  if (task.tags.length > 0) lines.push(`Tags: ${task.tags.join(', ')}`);
  if (task.desc.trim()) {
    lines.push('Details:', tokensToNames(task.desc, state.people).trim());
  }
  if (task.links.length > 0) {
    lines.push(
      `Links: ${task.links.map((l) => l.label || l.type || 'link').join(', ')}`,
    );
  }
  const source = task.sourceNoteId ? state.notes[task.sourceNoteId] : undefined;
  if (source) {
    lines.push(
      '',
      `Made from a note of ${noteDay(source)}:`,
      tokensToNames(source.body, state.people).trim(),
    );
  }
  return lines.join('\n');
}

/** A note: its date, project, the meeting it belongs to, and the body. */
export function noteContext(
  note: Note,
  state: Pick<Snapshot, 'projects' | 'people' | 'meetings'>,
): string {
  const meeting = note.meetingId ? state.meetings[note.meetingId] : undefined;
  const lines = [
    `Note of ${noteDay(note)}`,
    `Project: ${projectName(state, note.projectId)}`,
  ];
  if (meeting) {
    const role =
      note.phase === 'pre'
        ? 'prep for'
        : note.phase === 'post'
          ? 'debrief of'
          : 'about';
    lines.push(`Meeting: ${role} ${meeting.title} on ${day(meeting.date)}`);
  }
  lines.push('', tokensToNames(note.body, state.people).trim());
  return lines.join('\n');
}

/** What a Summarize button names. */
export type SummaryTarget =
  | { kind: 'project'; id: string }
  | { kind: 'task'; id: string }
  | { kind: 'meeting'; id: string }
  | { kind: 'note'; id: string }
  /** The seven days ending `toDay` (the Digest page). */
  | { kind: 'digest'; toDay: string };

export interface SummaryRequest {
  /** "Echo Base", "Shield review", "note of Wed 21 Oct 2026". */
  label: string;
  context: string;
  /** Where Save as note puts the result. */
  projectId: string | null;
  /** Set when summarizing a meeting, so the saved note links to it. */
  meetingId: string | null;
}

/** Everything one Summarize run needs, or null when the item is gone. */
export function summaryRequest(
  target: SummaryTarget,
  state: Snapshot,
): SummaryRequest | null {
  switch (target.kind) {
    case 'project': {
      const project = state.projects[target.id];
      if (!project) return null;
      return {
        label: project.name,
        context: projectContext(project.id, state),
        projectId: project.id,
        meetingId: null,
      };
    }
    case 'task': {
      const task = state.tasks[target.id];
      if (!task) return null;
      return {
        label: task.title,
        context: taskContext(task, state),
        projectId: task.projectId,
        meetingId: null,
      };
    }
    case 'meeting': {
      const meeting = state.meetings[target.id];
      if (!meeting) return null;
      return {
        label: meeting.title,
        context: meetingContext(meeting, state),
        projectId: meeting.projectId,
        meetingId: meeting.id,
      };
    }
    case 'digest': {
      const digest = buildDigest(state, weekEnding(target.toDay));
      const { fromDay, toDay } = digest.range;
      return {
        label: `week of ${day(fromDay)} – ${day(toDay)}`,
        context: `Weekly digest across every project.\n\n${digestMarkdown(digest)}`,
        projectId: null,
        meetingId: null,
      };
    }
    case 'note': {
      const note = state.notes[target.id];
      if (!note) return null;
      return {
        label: `note of ${noteDay(note)}`,
        context: noteContext(note, state),
        projectId: note.projectId,
        meetingId: null,
      };
    }
  }
}

/** The saved note's body: a title line, then the summary. */
export function summaryNoteBody(label: string, text: string): string {
  return `Summary of ${label}\n\n${text.trim()}`;
}

import { itemsOf } from './board';
import { addDays, formatDay } from './dates';
import { buildDigest, digestMarkdown, weekEnding } from './digest';
import { lanesOf, NOBODY, waitingCount } from './loops';
import { byWhen, timeRange } from './meetings';
import { tokensToNames } from './mentions';
import { noteTitle } from './notes';
import { buildRecap, recapCounts, recapMeetingLine } from './recap';
import {
  type AssigneeFilter,
  agenda,
  attention,
  attentionLine,
  FOCUS_DEFAULTS,
  type FocusOptions,
  focusBuckets,
  meId,
  prepLine,
  prepOf,
  tasksOfMeeting,
} from './select';
import {
  personLanes,
  personProjects,
  personStateLine,
  personStream,
  personTopics,
  projectKeep,
  projectStateLine,
  projectStream,
  type StreamItem,
  splitStream,
} from './stream';
import {
  blockedOf,
  type DateString,
  healthOf,
  type Meeting,
  milestonesOf,
  type Note,
  type Snapshot,
  type Task,
  type TimeString,
  topicsOf,
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

/**
 * The model's answer without its `<think>` block. Qwen3 still opens with
 * an empty `<think>\n\n</think>` when thinking is off; while the block (or
 * its opening tag) is still streaming, nothing is shown yet.
 */
export function withoutThinking(raw: string): string {
  const text = raw.trimStart();
  if (text.startsWith('<think>')) {
    const end = text.indexOf('</think>');
    return end === -1 ? '' : text.slice(end + '</think>'.length).trimStart();
  }
  return '<think>'.startsWith(text) ? '' : raw;
}

/** The spec's prompt, word for word. The context follows it. */
export const SYSTEM_PROMPT =
  'You are summarizing one item from a personal project tracker used by an engineering leader. Write a concise summary in plain markdown using short paragraphs and "- " bullets (headings, if any, as "### "). Structure: a 1–3 sentence overview; then bullets for key points; then "Open items" and "Suggested next steps" when the data supports them. Be specific, keep names and dates, do not invent anything not in the data, and stay under 220 words.';

/** How much of a project goes in (docs/SPEC.md § Claude summaries). */
export const SUMMARY_LIMITS = {
  doneTasks: 15,
  notes: 20,
  activity: 25,
  /** Sticky and text items from its whiteboard, in drawing order. */
  boardNotes: 30,
} as const;

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

function noteDay(note: Note): string {
  return day(note.createdAt.slice(0, 10));
}

/**
 * How much of a meeting goes in, so meeting mode's recap (#339) stays
 * within the model's window on a long meeting: the topics and action
 * items in order up to their caps, and the latest notes. Past a cap, a
 * section says how many more. Every title, outcome and note is cut to
 * its length.
 */
export const MEETING_LIMITS = {
  topics: 12,
  actions: 8,
  notes: 6,
  attendees: 8,
  /** Characters of a topic's title or an action item's title. */
  title: 80,
  /** Characters of a topic's outcome, or what an action item waits on. */
  outcome: 120,
  /** Characters of the meeting's own agenda text. */
  agenda: 400,
  /** Characters of one note. */
  note: 320,
} as const;

/**
 * The most a meeting's prompt and context come to, in characters, as
 * `BRIEF_BUDGET_CHARS` is for Brief me (`test/summaries.test.ts` fills
 * every section past its cap).
 */
export const MEETING_BUDGET_CHARS = 8750;

/** Text cut to `max` characters, its lines kept. */
function clipBlock(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max
    ? `${trimmed.slice(0, max - 1).trimEnd()}…`
    : trimmed;
}

/**
 * A meeting: title, date and times, project, attendees, agenda, its
 * topics in order (`- [x] title — outcome` once covered), its action
 * items (open, then done), and its linked notes, the latest
 * `MEETING_LIMITS.notes` oldest first, each labeled `[note]` (a legacy
 * `phase` is not shown). Summarize on a meeting row and meeting mode's
 * recap (#339) both send it; every section is capped (`MEETING_LIMITS`).
 */
export function meetingContext(
  meeting: Meeting,
  state: Pick<Snapshot, 'projects' | 'people' | 'notes'> &
    Partial<Pick<Snapshot, 'tasks'>>,
): string {
  const people = meeting.attendees
    .map((id) => state.people[id]?.name)
    .filter((n): n is string => Boolean(n));
  const shownPeople = people.slice(0, MEETING_LIMITS.attendees).map(clipName);
  if (people.length > shownPeople.length) {
    shownPeople.push(`and ${people.length - shownPeople.length} more`);
  }
  const range = timeRange(meeting, '24h');
  const lines = [
    `Meeting: ${clip(meeting.title, MEETING_LIMITS.title)}`,
    `Date: ${day(meeting.date)}${range ? `, ${range}` : ''}`,
    `Project: ${clipName(projectName(state, meeting.projectId))}`,
    `Attendees: ${shownPeople.join(', ') || 'none listed'}`,
  ];
  if (meeting.note) {
    lines.push(`Agenda: ${clipBlock(meeting.note, MEETING_LIMITS.agenda)}`);
  }

  const topics = topicsOf(meeting);
  if (topics.length > 0) {
    lines.push('', 'Topics:');
    for (const t of topics.slice(0, MEETING_LIMITS.topics)) {
      const title = clip(t.title, MEETING_LIMITS.title);
      lines.push(
        t.done
          ? `- [x] ${title}${t.outcome ? ` — ${clip(t.outcome, MEETING_LIMITS.outcome)}` : ''}`
          : `- [ ] ${title}`,
      );
    }
    const more = topics.length - MEETING_LIMITS.topics;
    if (more > 0) lines.push(`- and ${more} more`);
  }

  const items = tasksOfMeeting(state.tasks ?? {}, meeting.id);
  const all = [...items.open, ...items.done];
  if (all.length > 0) {
    lines.push('', 'Action items:');
    for (const t of all.slice(0, MEETING_LIMITS.actions)) {
      const line = taskLine(t, state, true).slice(2);
      lines.push(`- [${t.status === 'done' ? 'x' : ' '}] ${line}`);
    }
    const more = all.length - MEETING_LIMITS.actions;
    if (more > 0) lines.push(`- and ${more} more`);
  }

  const notes = Object.values(state.notes)
    .filter((n) => n.meetingId === meeting.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (notes.length > 0) {
    lines.push('', 'Linked notes:');
    const earlier = notes.length - MEETING_LIMITS.notes;
    if (earlier > 0) {
      lines.push(
        `(${earlier} earlier ${earlier === 1 ? 'note' : 'notes'} left out)`,
        '',
      );
    }
    for (const n of notes.slice(-MEETING_LIMITS.notes)) {
      lines.push(
        `[note] ${noteDay(n)}`,
        clipBlock(tokensToNames(n.body, state.people), MEETING_LIMITS.note),
        '',
      );
    }
  }
  return lines.join('\n').trimEnd();
}

/**
 * One task line for a project's lists: title, then what is set. `short`
 * cuts the title and the names (a meeting's action items).
 */
function taskLine(task: Task, state: Lookup, short = false): string {
  const bits = [
    `- ${short ? clip(task.title, MEETING_LIMITS.title) : task.title}`,
  ];
  if (task.priority !== 'none')
    bits.push(`priority ${PRIORITY_WORDS[task.priority]}`);
  if (task.due) bits.push(`due ${day(task.due)}`);
  const assignee = personName(state, task.assignee);
  if (assignee)
    bits.push(`assigned to ${short ? clipName(assignee) : assignee}`);
  if (task.completedAt)
    bits.push(`closed ${day(task.completedAt.slice(0, 10))}`);
  const waiting = blockedLine(task, state);
  if (waiting)
    bits.push(short ? clip(waiting, MEETING_LIMITS.outcome) : waiting);
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
 * tasks, every milestone, every meeting, its whiteboard's first 30 sticky
 * and text items, the last 20 notes newest first,
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
    lines.push('', 'Milestones, by date:');
    for (const m of milestones) lines.push(`- ${day(m.date)}: ${m.title}`);
  }

  const meetings = Object.values(state.meetings)
    .filter((m) => m.projectId === projectId)
    .sort(byWhen);
  if (meetings.length > 0) {
    lines.push('', 'Meetings:');
    for (const m of meetings) {
      const range = timeRange(m, '24h');
      const topics = topicsOf(m);
      const covered = topics.filter((t) => t.done).length;
      lines.push(
        `- ${day(m.date)}${range ? ` ${range}` : ''}: ${m.title}${
          topics.length > 0
            ? ` (${covered} of ${topics.length} topics covered)`
            : ''
        }`,
      );
    }
  }

  // Absent in a snapshot cached before whiteboards.
  const board = itemsOf(state.boardItems ?? {}, projectId)
    .filter((b) => (b.kind === 'sticky' || b.kind === 'text') && b.text.trim())
    .slice(0, SUMMARY_LIMITS.boardNotes);
  if (board.length > 0) {
    lines.push('', 'Whiteboard notes:');
    for (const b of board) {
      lines.push(`- ${tokensToNames(b.text, state.people).trim()}`);
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
        `[note] ${noteDay(n)}`,
        tokensToNames(n.body, state.people).trim(),
        '',
      );
    }
    lines.pop();
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
 * A task: its fields, the meeting it is an action item of, details,
 * link labels, the note it was made from, if any, and its running notes, oldest first (the last 20).
 */
export function taskContext(
  task: Task,
  state: Pick<Snapshot, 'projects' | 'people' | 'notes'> &
    Partial<Pick<Snapshot, 'meetings'>>,
): string {
  const meeting = task.meetingId ? state.meetings?.[task.meetingId] : undefined;
  const lines = [
    `Task: ${task.title}`,
    `Project: ${projectName(state, task.projectId)}`,
    ...(meeting
      ? [`Action item from: ${meeting.title} on ${day(meeting.date)}`]
      : []),
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
  const notes = Object.values(state.notes)
    .filter((n) => n.taskId === task.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-SUMMARY_LIMITS.notes);
  if (notes.length > 0) {
    lines.push('', 'Notes, oldest first:');
    for (const n of notes) {
      lines.push(
        `[note] ${noteDay(n)}`,
        tokensToNames(n.body, state.people).trim(),
        '',
      );
    }
    lines.pop();
  }
  return lines.join('\n');
}

/* ---- Brief me (#259) ----------------------------------------------------- */

/**
 * Focus's Brief me: the model turns the day's facts into prose. The facts
 * come from the selectors Focus already uses, so the numbers stay right;
 * the model only writes.
 */
export const BRIEF_PROMPT =
  'You are writing a morning briefing for an engineering leader from their personal project tracker. Write one short paragraph about what happened since the last working day, then one short paragraph about what today holds, then up to 3 "- " bullets for what to do first. Plain markdown, no headings. Keep names, dates and counts exactly as given, do not invent anything not in the data, skip a section that says "none", and stay under 150 words.';

/**
 * How much of each section goes in, so the prompt and the context stay
 * near 2.5k tokens on a busy day (the model's window is 4096, and 900 of
 * them are the answer's). Past a cap, a section says how many more.
 */
export const BRIEF_LIMITS = {
  closed: 8,
  added: 5,
  meetingsHeld: 5,
  notes: 5,
  activity: 6,
  agenda: 6,
  due: 8,
  /** Today's lanes (#332): Mine and To decide. */
  mine: 8,
  decide: 5,
  /** People in Waiting on; each lists at most `waitingTasks`. */
  waiting: 4,
  waitingTasks: 2,
  attention: 5,
  /** Characters of any one title, first line or activity line. */
  text: 60,
  /** Characters of a project's or a person's name. */
  name: 40,
} as const;

/**
 * The most the prompt and the context come to, in characters, whatever
 * the data: about 2.5k tokens at 3.5 characters a token (Qwen3's
 * tokenizer on English runs nearer 4). The caps above keep it there
 * (`test/summaries.test.ts` fills every section past them, every title
 * and name at its longest).
 */
export const BRIEF_BUDGET_CHARS = 8750;

/** A title or a first line, on one line and cut to `max` characters. */
function clip(text: string, max: number = BRIEF_LIMITS.text): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function clipName(name: string): string {
  return clip(name, BRIEF_LIMITS.name);
}

/** "Tasks closed (12):", then the first `cap` lines and "- and 4 more". */
function section(
  title: string,
  lines: string[],
  cap: number,
  /** When there are more than `lines` holds (the recap's own cap). */
  total = lines.length,
): string[] {
  const head = `${title} (${total}):`;
  if (total === 0) return [head, 'none'];
  const shown = lines.slice(0, cap);
  return total > shown.length
    ? [head, ...shown, `- and ${total - shown.length} more`]
    : [head, ...shown];
}

function filterLabel(state: Lookup, filter: AssigneeFilter): string {
  switch (filter.kind) {
    case 'anyone':
      return '';
    case 'mine':
      return 'my own tasks';
    case 'unassigned':
      return 'unassigned tasks';
    case 'person':
      return `tasks assigned to ${clipName(personName(state, filter.id) ?? 'someone no longer listed')}`;
  }
}

/**
 * What Brief me sends (Today, #332): the last working day (`buildRecap`,
 * #258), then today's Agenda (each meeting with its prep line), Due
 * (overdue and today, not blocked), Today's three lanes (`lanesOf`:
 * Mine, Waiting on, To decide) and Attention. Archived projects are left
 * out and the saved settings apply (`who` narrowing the recap, Due and
 * Mine as Today narrows them; Attention's rules; #311). A lane hidden on
 * Today is still sent. Mentions are names; every section is capped
 * (`BRIEF_LIMITS`).
 */
export function briefContext(
  state: Snapshot,
  today: DateString,
  options: FocusOptions = FOCUS_DEFAULTS,
): string {
  const assignee = options.who;
  const me = meId(state.people);
  const where = (id: string | null) => clipName(projectName(state, id));
  const group = (project: { name: string } | null) =>
    clipName(project?.name ?? 'General');
  const title = (t: Task) => clip(tokensToNames(t.title, state.people));
  const recap = buildRecap(state, today, assignee);
  const { from, to } = recap.window;
  const filter = filterLabel(state, assignee);

  const lines = [`Today is ${day(today)}.`];
  if (filter) lines.push(`Tasks are narrowed to ${filter}.`);

  lines.push(
    '',
    `Since the last working day (${from === to ? day(from) : `${day(from)} to ${day(to)}`}):`,
    '',
    ...section(
      'Tasks closed',
      recap.closed.flatMap((g) =>
        g.items.map((t) => `- ${title(t)} (${group(g.project)})`),
      ),
      BRIEF_LIMITS.closed,
    ),
    '',
    ...section(
      'Tasks added',
      recap.added.map((t) => `- ${title(t)} (${where(t.projectId)})`),
      BRIEF_LIMITS.added,
    ),
    '',
    ...section(
      'Meetings held',
      recap.meetings.map((m) => {
        const what = recapMeetingLine(m);
        return `- ${day(m.meeting.date)}: ${clip(m.meeting.title)} (${where(m.meeting.projectId)})${what ? `: ${what}` : ''}`;
      }),
      BRIEF_LIMITS.meetingsHeld,
    ),
    '',
    ...section(
      'Notes written',
      recap.notes.flatMap((g) =>
        g.items.map(
          (n) => `- ${group(g.project)}: ${clip(noteTitle(n, state.people))}`,
        ),
      ),
      BRIEF_LIMITS.notes,
    ),
    '',
    ...section(
      'Other changes',
      recap.activity.flatMap((g) =>
        g.items.map(
          (e) =>
            `- ${group(g.project)}: ${clip(tokensToNames(e.text, state.people))}`,
        ),
      ),
      BRIEF_LIMITS.activity,
      recapCounts(recap).activity,
    ),
  );

  const meetings = agenda(state.meetings, state.projects, today).filter(
    (item) => item.date === today,
  );
  const buckets = focusBuckets(
    state.tasks,
    state.projects,
    today,
    me,
    assignee,
  );
  const due = [...buckets.overdue, ...buckets.today];
  // Today's lanes (#331, #332): Mine narrowed as Today narrows it.
  const lanes = lanesOf(state, me);
  const mine =
    assignee.kind === 'mine' && me
      ? lanes.mine.filter((t) => t.assignee === me)
      : lanes.mine;
  const projects = attention(
    state.projects,
    today,
    options.targetDays,
    options.quietDays,
    options.yellow,
  );

  lines.push(
    '',
    `Today (${day(today)}):`,
    '',
    ...section(
      'Agenda',
      meetings.map((item) => {
        if (item.kind === 'milestone') {
          return `- Milestone: ${clip(item.milestone.title)} (${clipName(item.project.name)})`;
        }
        const m = item.meeting;
        const range = timeRange(m, '24h');
        const prep = prepLine(prepOf(m, state), today);
        return `- ${range ? `${range} ` : ''}${clip(m.title)} (${where(m.projectId)})${prep ? `: ${prep}` : ''}`;
      }),
      BRIEF_LIMITS.agenda,
    ),
    '',
    ...section(
      'Due (overdue and today)',
      due.map((t) => {
        const bits = [
          `- ${title(t)} (${where(t.projectId)})`,
          t.due < today ? `overdue since ${day(t.due)}` : 'due today',
        ];
        if (t.priority !== 'none') {
          bits.push(`priority ${PRIORITY_WORDS[t.priority]}`);
        }
        const who = personName(state, t.assignee);
        if (who) bits.push(`assigned to ${clipName(who)}`);
        return bits.join(', ');
      }),
      BRIEF_LIMITS.due,
    ),
    '',
    ...section(
      'My open tasks',
      mine.map(
        (t) =>
          `- ${title(t)} (${where(t.projectId)})${t.due ? `, due ${day(t.due)}` : ''}`,
      ),
      BRIEF_LIMITS.mine,
    ),
    '',
    ...section(
      'Waiting on others',
      lanes.waiting.map((g) => {
        const who =
          g.personId === NOBODY
            ? 'no one listed'
            : clipName(
                personName(state, g.personId) ?? 'someone no longer listed',
              );
        const shown = g.tasks.slice(0, BRIEF_LIMITS.waitingTasks).map(title);
        const more = g.tasks.length - shown.length;
        if (more > 0) shown.push(`and ${more} more`);
        const count = `${g.tasks.length} ${g.tasks.length === 1 ? 'task' : 'tasks'}`;
        return `- ${who}, ${count}: ${shown.join('; ')}`;
      }),
      BRIEF_LIMITS.waiting,
    ),
    '',
    ...section(
      'To decide',
      lanes.decide.map((t) => `- ${title(t)} (${where(t.projectId)})`),
      BRIEF_LIMITS.decide,
    ),
    '',
    ...section(
      'Projects that need attention',
      projects.map(
        ({ project: p, reasons }) =>
          `- ${clipName(p.name)}: ${attentionLine(reasons)}`,
      ),
      BRIEF_LIMITS.attention,
    ),
  );
  return lines.join('\n');
}

/** Brief me's label, and the first line of the note it saves. */
export function briefLabel(today: DateString): string {
  return `Brief · ${day(today)}`;
}

/** The saved brief: "Brief · Wed 28 Oct 2026", then the text. */
export function briefNoteBody(today: DateString, text: string): string {
  return `${briefLabel(today)}\n\n${text.trim()}`;
}

/* ---- Rooms and meeting mode (#339) -------------------------------------- */

/**
 * A room's Summarize: one or two sentences under the computed state
 * line. The facts come from what the room shows; the model only writes.
 */
export const ROOM_PROMPT =
  'You are writing the state of one room in a personal project tracker used by an engineering leader: a project, or a person they work with. Write one or two plain sentences on where things stand and what needs attention next. No headings, no bullets, no preamble. Keep names and dates exactly as given, do not invent anything not in the data, and stay under 60 words.';

/** Meeting mode's Summarize: a short recap of the meeting. */
export const RECAP_PROMPT =
  'You are writing a short recap of one meeting from a personal project tracker used by an engineering leader. Write one or two sentences on what the meeting covered, then "- " bullets for what was decided or agreed, then the action items as "- " bullets with who owns them. Plain markdown, no headings. Keep names and dates exactly as given, do not invent anything not in the data, skip what is not there, and stay under 150 words.';

/** How many days of a room's stream go in, today included. */
export const ROOM_STREAM_DAYS = 14;

/** How much of a room goes in (`roomContext`); past a cap, how many more. */
export const ROOM_LIMITS = {
  /** Each of the three lanes; Waiting on counts people. */
  mine: 8,
  waiting: 4,
  waitingTasks: 2,
  decide: 5,
  /** A person's To discuss topics. */
  topics: 5,
  upcoming: 5,
  stream: 20,
  /** Characters of one note in the stream. */
  note: 200,
} as const;

/**
 * The most a room's prompt and context come to, in characters, as
 * `BRIEF_BUDGET_CHARS` is for Brief me.
 */
export const ROOM_BUDGET_CHARS = 8750;

/** What a room's Summarize is about: the room, narrowed or not. */
export type RoomSubject =
  | { kind: 'project'; id: string; person?: string | null }
  | { kind: 'person'; id: string; project?: string | null };

/** The lanes' headings, as each room labels them. */
const ROOM_LANES = {
  project: { mine: 'Mine', waiting: 'Waiting on', decide: 'To decide' },
  person: { mine: 'You owe', waiting: 'They owe you', decide: 'To discuss' },
} as const;

/** One stream item, as a line: its day, what it is, its words. */
function streamLine(
  item: StreamItem,
  state: Snapshot,
  withProject: boolean,
): string {
  const date = day(item.at.slice(0, 10));
  const where = (id: string | null) =>
    withProject ? ` (${clipName(projectName(state, id))})` : '';
  switch (item.kind) {
    case 'note':
      return `- ${date}: Note${where(item.note.projectId)}: ${clip(tokensToNames(item.note.body, state.people), ROOM_LIMITS.note)}`;
    case 'task': {
      const what = item.event === 'done' ? 'Task done' : 'Task added';
      return `- ${date}: ${what}${where(item.task.projectId)}: ${clip(tokensToNames(item.task.title, state.people))}`;
    }
    case 'meeting': {
      const m = item.meeting;
      const topics = topicsOf(m);
      const covered = topics.filter((t) => t.done).length;
      return `- ${date}: Meeting${where(m.projectId)}: ${clip(m.title)}${
        topics.length > 0
          ? ` (${covered} of ${topics.length} topics covered)`
          : ''
      }`;
    }
    case 'milestone':
      return `- ${date}: Milestone${where(item.projectId)}: ${clip(item.milestone.title)}`;
  }
}

/** What is coming up, as a line: its day and time, what it is. */
function upcomingLine(
  item: StreamItem,
  state: Snapshot,
  withProject: boolean,
): string {
  if (item.kind !== 'meeting') return streamLine(item, state, withProject);
  const m = item.meeting;
  const range = timeRange(m, '24h');
  const where = withProject
    ? ` (${clipName(projectName(state, m.projectId))})`
    : '';
  return `- ${day(m.date)}${range ? ` ${range}` : ''}: Meeting${where}: ${clip(m.title)}`;
}

/**
 * What a room's Summarize sends (#339): the room and its state line as
 * the room computes it, its three lanes (a person's with the topics to
 * discuss), what is coming up (meetings and milestones), then the last
 * `ROOM_STREAM_DAYS` days of the stream, newest first. A narrowed room
 * sends what it shows. `now` is the time of day on the local calendar.
 * Every section is capped (`ROOM_LIMITS`), so a busy room stays within
 * `ROOM_BUDGET_CHARS`. Empty when the room is gone.
 */
export function roomContext(
  subject: RoomSubject,
  state: Snapshot,
  today: DateString,
  now: TimeString,
): string {
  const me = meId(state.people);
  const isProject = subject.kind === 'project';
  const projectId = isProject ? subject.id : (subject.project ?? null);
  const personId = isProject ? (subject.person ?? null) : subject.id;
  const project = projectId ? state.projects[projectId] : undefined;
  const person = personId ? state.people[personId] : undefined;
  if (isProject ? !project : !person) return '';

  const lanes = isProject
    ? lanesOf(state, me, projectKeep(subject.id, person ? personId : null))
    : personLanes(state, me, subject.id, project ? projectId : null);
  const open = lanes.mine.length + waitingCount(lanes) + lanes.decide.length;

  const lines: string[] = [];
  if (isProject && project) {
    lines.push(
      `Project: ${clipName(project.name)}`,
      `Org: ${clipName(project.org) || 'none'}`,
    );
    if (person) lines.push(`Narrowed to: ${clipName(person.name)}`);
    lines.push(
      `Today is ${day(today)}.`,
      `State: ${projectStateLine(
        {
          ...project,
          milestones: milestonesOf(project).map((m) => ({
            ...m,
            title: clip(m.title),
          })),
        },
        open,
        today,
        day,
      ).join(' · ')}`,
    );
  } else if (person) {
    lines.push(
      `Person: ${clipName(person.name)}${person.me ? ' (the owner)' : ''}`,
    );
    if (project) lines.push(`Narrowed to: ${clipName(project.name)}`);
    lines.push(
      `Today is ${day(today)}.`,
      `State: ${personStateLine(
        { role: clip(person.role) },
        personProjects(state, person.id).length,
        open,
      ).join(' · ')}`,
    );
  }

  const labels = ROOM_LANES[subject.kind];
  const title = (t: Task) => clip(tokensToNames(t.title, state.people));
  const where = (t: Task) =>
    isProject || project
      ? ''
      : ` (${clipName(projectName(state, t.projectId))})`;
  const loop = (t: Task) =>
    `- ${title(t)}${where(t)}${t.due ? `, due ${day(t.due)}` : ''}`;
  lines.push(
    '',
    ...section(labels.mine, lanes.mine.map(loop), ROOM_LIMITS.mine),
    '',
    ...section(
      labels.waiting,
      lanes.waiting.map((g) => {
        const who =
          g.personId === NOBODY
            ? 'no one listed'
            : clipName(
                personName(state, g.personId) ?? 'someone no longer listed',
              );
        const shown = g.tasks.slice(0, ROOM_LIMITS.waitingTasks).map(title);
        const more = g.tasks.length - shown.length;
        if (more > 0) shown.push(`and ${more} more`);
        const count = `${g.tasks.length} ${g.tasks.length === 1 ? 'task' : 'tasks'}`;
        return `- ${who}, ${count}: ${shown.join('; ')}`;
      }),
      ROOM_LIMITS.waiting,
    ),
    '',
    ...section(labels.decide, lanes.decide.map(loop), ROOM_LIMITS.decide),
  );
  if (!isProject && person) {
    const topics = personTopics(
      state,
      person.id,
      today,
      now,
      project ? projectId : null,
    );
    lines.push(
      '',
      ...section(
        'Topics to discuss',
        topics.map(
          ({ meeting, topic }) =>
            `- ${clip(topic.title)} (${clipName(meeting.title)}, ${day(meeting.date)})`,
        ),
        ROOM_LIMITS.topics,
      ),
    );
  }

  const stream = isProject
    ? projectStream(state, subject.id, person ? personId : null)
    : personStream(state, subject.id, project ? projectId : null);
  const { upcoming, past } = splitStream(stream, `${today}T${now}`);
  const from = `${addDays(today, 1 - ROOM_STREAM_DAYS)}T00:00`;
  const recent = past.filter((item) => item.at >= from);
  const withProject = !isProject && !project;
  lines.push(
    '',
    ...section(
      'Coming up',
      upcoming.map((item) => upcomingLine(item, state, withProject)),
      ROOM_LIMITS.upcoming,
    ),
    '',
    ...section(
      `The last ${ROOM_STREAM_DAYS} days, newest first`,
      recent.map((item) => streamLine(item, state, withProject)),
      ROOM_LIMITS.stream,
    ),
  );
  return lines.join('\n');
}

/** What a Summarize button names. */
export type SummaryTarget =
  | { kind: 'task'; id: string }
  /** A meeting row's Summarize, in the panel. */
  | { kind: 'meeting'; id: string }
  /** Meeting mode's recap (#339), in a card under its header. */
  | { kind: 'recap'; id: string }
  /**
   * A room's state (#339), in a card under its state line, as of `today`
   * at `now` (the time of day).
   */
  | { kind: 'room'; room: RoomSubject; today: DateString; now: TimeString }
  /** The seven days ending `toDay` (the Digest page). */
  | { kind: 'digest'; toDay: string }
  /**
   * Focus's Brief me (#259): `today`, with Focus's settings as the page
   * reads them (#311); everyone's tasks and the default rules without.
   */
  | { kind: 'brief'; today: DateString; options?: FocusOptions };

export interface SummaryRequest {
  /** "Echo Base", "Shield review", "Brief · Wed 28 Oct 2026". */
  label: string;
  /**
   * What follows "Summary of" in the saved note: the label, with a
   * person as `@Name` so the note mentions them and files to their room.
   */
  noteLabel: string;
  context: string;
  /** Where Save as note puts the result. */
  projectId: string | null;
  /** Set when summarizing a meeting, so the saved note links to it. */
  meetingId: string | null;
  /**
   * The system prompt: `SYSTEM_PROMPT`, `BRIEF_PROMPT` for a brief,
   * `ROOM_PROMPT` for a room, `RECAP_PROMPT` for a meeting's recap.
   */
  prompt: string;
}

/**
 * Which card shows a target's summary: Today's Brief me card, a room's,
 * or meeting mode's, by a key; null for the summary panel.
 */
export function cardOf(target: SummaryTarget): string | null {
  switch (target.kind) {
    case 'brief':
      return 'brief';
    case 'recap':
      return `recap:${target.id}`;
    case 'room': {
      const { room } = target;
      const narrow = room.kind === 'project' ? room.person : room.project;
      return `room:${room.kind}:${room.id}:${narrow ?? ''}`;
    }
    default:
      return null;
  }
}

/** Everything one Summarize run needs, or null when the item is gone. */
export function summaryRequest(
  target: SummaryTarget,
  state: Snapshot,
): SummaryRequest | null {
  switch (target.kind) {
    case 'room': {
      const { room } = target;
      const context = roomContext(room, state, target.today, target.now);
      if (!context) return null;
      const projectId =
        room.kind === 'project' ? room.id : (room.project ?? null);
      const personId = room.kind === 'person' ? room.id : room.person;
      const project = projectId ? state.projects[projectId] : undefined;
      const person = personId ? state.people[personId] : undefined;
      const label =
        room.kind === 'person'
          ? (person?.name ?? '')
          : `${project?.name ?? ''}${person ? ` with ${person.name}` : ''}`;
      const noteLabel =
        room.kind === 'person'
          ? `@${person?.name ?? ''}`
          : `${project?.name ?? ''}${person ? ` with @${person.name}` : ''}`;
      return {
        label,
        noteLabel,
        context,
        projectId: project ? (projectId ?? null) : null,
        meetingId: null,
        prompt: ROOM_PROMPT,
      };
    }
    case 'recap': {
      const meeting = state.meetings[target.id];
      if (!meeting) return null;
      return {
        label: meeting.title,
        noteLabel: meeting.title,
        context: meetingContext(meeting, state),
        projectId: meeting.projectId,
        meetingId: meeting.id,
        prompt: RECAP_PROMPT,
      };
    }
    case 'task': {
      const task = state.tasks[target.id];
      if (!task) return null;
      return {
        label: task.title,
        noteLabel: task.title,
        context: taskContext(task, state),
        projectId: task.projectId,
        meetingId: null,
        prompt: SYSTEM_PROMPT,
      };
    }
    case 'meeting': {
      const meeting = state.meetings[target.id];
      if (!meeting) return null;
      return {
        label: meeting.title,
        noteLabel: meeting.title,
        context: meetingContext(meeting, state),
        projectId: meeting.projectId,
        meetingId: meeting.id,
        prompt: SYSTEM_PROMPT,
      };
    }
    case 'digest': {
      const digest = buildDigest(state, weekEnding(target.toDay));
      const { fromDay, toDay } = digest.range;
      const label = `week of ${day(fromDay)} – ${day(toDay)}`;
      return {
        label,
        noteLabel: label,
        context: `Weekly digest across every project.\n\n${digestMarkdown(digest)}`,
        projectId: null,
        meetingId: null,
        prompt: SYSTEM_PROMPT,
      };
    }
    case 'brief':
      return {
        label: briefLabel(target.today),
        noteLabel: briefLabel(target.today),
        context: briefContext(state, target.today, target.options),
        projectId: null,
        meetingId: null,
        prompt: BRIEF_PROMPT,
      };
  }
}

/** The saved note's body: a title line, then the summary. */
export function summaryNoteBody(label: string, text: string): string {
  return `Summary of ${label}\n\n${text.trim()}`;
}

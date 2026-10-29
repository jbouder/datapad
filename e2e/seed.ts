import { addDays, daysBetween, localDate } from '../shared/dates';
import fixture from '../test/fixtures/export.json' with { type: 'json' };

/** Whole calendar days between two dates (`shared/dates.ts`). */
export { daysBetween };

/**
 * A populated tracker for specs that need one: the fictional export the
 * unit tests use, posted to `/api/import`. The repository is public and
 * never holds real data.
 *
 * The export's dates were written around {@link SEED_ANCHOR}. Every run
 * shifts them by the whole days between that anchor and today, so the seed
 * sits in the same place relative to today on any date: Echo Base's
 * shield review is always today, its first task always three days overdue.
 */

/** The day the export's dates were written around. */
export const SEED_ANCHOR = '2026-10-27';

/** Today on the local calendar (the runner and the browser share a zone). */
export function today(): string {
  return localDate(new Date());
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/;

/**
 * `value` with every date (`YYYY-MM-DD`) and ISO timestamp in it moved
 * `days` days. A string is moved only when it is a date or a timestamp as
 * a whole, so text that mentions a date (a note body, a title) stays as it
 * is. A timestamp keeps its local time of day, across a DST change too.
 */
export function shiftDates<T>(value: T, days: number): T {
  if (typeof value === 'string') {
    if (DAY.test(value)) return addDays(value, days) as T;
    if (TIMESTAMP.test(value)) {
      const when = new Date(value);
      when.setDate(when.getDate() + days);
      return when.toISOString() as T;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => shiftDates(v, days)) as T;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, shiftDates(v, days)]),
    ) as T;
  }
  return value;
}

export type Seed = typeof fixture;

/** The days the seed is shifted by in this test. */
let shift = daysBetween(SEED_ANCHOR, today());

/**
 * The seed for this test, shifted to today. A live binding: the fixtures
 * rebuild it before every test (`refreshSeed`), so a run that crosses
 * midnight moves it with the day. Clone it before changing it.
 */
export let SEED: Seed = shiftDates(fixture, shift);

/** Rebuild {@link SEED} for today. The fixtures call it before each test. */
export function refreshSeed() {
  shift = daysBetween(SEED_ANCHOR, today());
  SEED = shiftDates(fixture, shift);
}

/**
 * Where a day from the original export (`test/fixtures/export.json`) falls
 * in this test's seed. Assert seed dates through the app's formatters:
 * `formatDay(seedDay('2026-11-14'), today())`, never a literal.
 */
export function seedDay(day: string): string {
  return addDays(day, shift);
}

/**
 * A timestamp from the original export, shifted as the seed shifts it.
 */
export function seedTime(timestamp: string): string {
  return shiftDates(timestamp, shift);
}

/** Documents per collection in the seed, as the import reports them. */
export const SEED_COUNTS = {
  projects: Object.keys(fixture.projects).length,
  tasks: Object.keys(fixture.tasks).length,
  notes: Object.keys(fixture.notes).length,
  meetings: Object.keys(fixture.meetings).length,
  people: Object.keys(fixture.people).length,
  activity: Object.keys(fixture.activity).length,
  // The artifact's export has no settings.
  settings: 0,
  decisions: 0,
  orgs: 0,
  templates: 0,
  boardItems: 0,
};

/** Noon on `day` in the local zone, as an ISO timestamp. */
export function localNoon(day: string): string {
  return new Date(`${day}T12:00:00`).toISOString();
}

type Doc = Record<string, unknown>;

/** An action item from last week's Shield review (`e-5`). */
const actionItem = (id: string, title: string, fields: Doc): Doc => ({
  id,
  title,
  projectId: 'p-echo',
  status: 'open',
  priority: 'none',
  due: '',
  desc: '',
  tags: [],
  assignee: '',
  links: [],
  order: 10,
  meetingId: 'e-5',
  blocked: null,
  completedAt: null,
  ...fields,
});

/**
 * {@link SEED} with something in every part of Focus's briefing (#206),
 * relative to today (build it inside a test):
 *
 * - Waiting on: Han's motivator blocked on Leia for 9 days, Chewie's
 *   hangar doors on no one for 3.
 * - Attention: Endor (added: red, target in 6 days, quiet 16 days), then
 *   Echo Base (yellow); the Falcon is paused, so not there.
 * - Agenda: today's Shield review has 2 of 3 topics left (1 carried), and
 *   last week's Shield review (the same series) left 2 action items open;
 *   a Han 1:1 the day after tomorrow (Week only) has no note yet.
 * - Follow-ups: those 2 action items, one Leia's (due tomorrow).
 * - Due: the shield generator (Leia's, 3 days overdue), the tauntaun vet
 *   (today), the docking permit (tomorrow: This week, unless today is
 *   Sunday).
 * - The week: 1 closed (an action item, yesterday), 1 added (the tauntaun
 *   vet), 1 overdue.
 */
export function briefingSeed(): Seed {
  const s = structuredClone(SEED);
  const day = (n: number) => addDays(today(), n);
  const tasks = s.tasks as Record<string, Doc>;
  const projects = s.projects as Record<string, Doc>;
  const meetings = s.meetings as Record<string, Doc>;

  Object.assign(tasks['t-5'] ?? {}, {
    blocked: { on: 'u-leia', note: 'Sign-off on the budget' },
    updatedAt: localNoon(day(-9)),
  });
  Object.assign(tasks['t-2'] ?? {}, {
    blocked: { on: null, note: 'Insulation on back order' },
    updatedAt: localNoon(day(-3)),
  });
  Object.assign(tasks['t-4'] ?? {}, { due: day(0) });
  Object.assign(tasks['t-6'] ?? {}, { due: day(1) });
  const met = localNoon(day(-7));
  tasks['t-8'] = actionItem('t-8', 'Draft the power budget', {
    assignee: 'u-han',
    createdAt: met,
    updatedAt: met,
  });
  tasks['t-9'] = actionItem('t-9', 'Send the ridge survey', {
    assignee: 'u-leia',
    due: day(1),
    order: 11,
    createdAt: met,
    updatedAt: met,
  });
  tasks['t-10'] = actionItem('t-10', 'Order thermal blankets', {
    status: 'done',
    order: 12,
    createdAt: met,
    updatedAt: localNoon(day(-1)),
    completedAt: localNoon(day(-1)),
  });

  Object.assign(projects['p-echo'] ?? {}, { health: 'yellow' });
  projects['p-endor'] = {
    ...structuredClone(projects['p-echo']),
    id: 'p-endor',
    name: 'Endor shield bunker',
    health: 'red',
    startDate: day(-30),
    targetDate: day(6),
    tags: [],
    desc: '',
    members: ['u-han'],
    links: [],
    milestones: [],
    createdAt: localNoon(day(-30)),
    updatedAt: localNoon(day(-16)),
  };

  Object.assign(meetings['e-1'] ?? {}, {
    topics: [
      { id: 'tp-1', title: 'Power budget', done: true, outcome: 'Approved' },
      {
        id: 'tp-2',
        title: 'North ridge',
        done: false,
        outcome: '',
        carriedFrom: day(-7),
      },
      { id: 'tp-3', title: 'Probe droid sightings', done: false, outcome: '' },
    ],
  });
  meetings['e-5'] = {
    ...structuredClone(meetings['e-1']),
    id: 'e-5',
    date: day(-7),
    topics: [],
    createdAt: localNoon(day(-8)),
    updatedAt: met,
  };
  meetings['e-6'] = {
    id: 'e-6',
    projectId: null,
    title: 'Han 1:1',
    date: day(2),
    time: '10:00',
    end: '10:30',
    attendees: ['u-han'],
    link: '',
    note: '',
    createdAt: localNoon(day(-1)),
    updatedAt: localNoon(day(-1)),
  };
  return s;
}

/** `time` (`HH:MM`) on `day` in the local zone, as an ISO timestamp. */
function localAt(day: string, time: string): string {
  return new Date(`${day}T${time}:00`).toISOString();
}

/**
 * {@link briefingSeed} with a full Since yesterday (#258). Everything is
 * yesterday at a local time, which is in the recap's window whatever the
 * weekday (on Monday it is Sunday, the end of Friday through Sunday) and
 * whatever the zone. `briefingSeed` alone already has one thing there:
 * the thermal blankets, closed yesterday.
 *
 * - Closed: the thermal blankets (Echo Base); not the Yavin report, closed
 *   yesterday too but in an archived project.
 * - Added: the ice caves (an action item, Leia's) and the bacta tanks
 *   (General, no one's).
 * - Meetings held: the ridge patrol debrief, 2 of 3 topics covered, the
 *   ice caves its one action item, one note.
 * - Notes written: that note.
 * - Activity: Echo Base's health set to yellow; its other lines yesterday
 *   (the action item, the note, the close) say what the rest already
 *   does.
 */
export function recapSeed(): Seed {
  const s = briefingSeed();
  const yesterday = addDays(today(), -1);
  const tasks = s.tasks as Record<string, Doc>;
  const meetings = s.meetings as Record<string, Doc>;
  const notes = s.notes as Record<string, Doc>;
  const activity = s.activity as Record<string, { events: Doc[] }>;

  Object.assign(tasks['t-7'] ?? {}, {
    completedAt: localAt(yesterday, '11:00'),
    updatedAt: localAt(yesterday, '11:00'),
  });
  meetings['e-7'] = {
    id: 'e-7',
    projectId: 'p-echo',
    title: 'Ridge patrol debrief',
    date: yesterday,
    time: '15:00',
    end: '15:30',
    attendees: ['u-leia', 'u-han'],
    link: '',
    note: '',
    topics: [
      { id: 'tp-7a', title: 'Probe droid', done: true, outcome: 'Destroyed' },
      { id: 'tp-7b', title: 'Ice caves', done: true, outcome: 'Map them' },
      { id: 'tp-7c', title: 'Wampa sightings', done: false, outcome: '' },
    ],
    createdAt: localAt(yesterday, '09:00'),
    updatedAt: localAt(yesterday, '15:30'),
  };
  tasks['t-11'] = actionItem('t-11', 'Map the ice caves', {
    meetingId: 'e-7',
    assignee: 'u-leia',
    order: 13,
    createdAt: localAt(yesterday, '15:20'),
    updatedAt: localAt(yesterday, '15:20'),
  });
  tasks['t-12'] = actionItem('t-12', 'Restock the bacta tanks', {
    projectId: null,
    meetingId: null,
    order: 14,
    createdAt: localAt(yesterday, '16:00'),
    updatedAt: localAt(yesterday, '16:00'),
  });
  notes['n-5'] = {
    id: 'n-5',
    projectId: 'p-echo',
    body: 'Patrol found probe droid wreckage on the ridge',
    pinned: false,
    meetingId: 'e-7',
    phase: null,
    createdAt: localAt(yesterday, '15:25'),
  };
  const echo = activity['p-echo'] ?? { events: [] };
  echo.events.unshift(
    { t: localAt(yesterday, '16:30'), text: 'Health set to yellow' },
    { t: localAt(yesterday, '15:25'), text: 'Added a note' },
    {
      t: localAt(yesterday, '15:20'),
      text: 'Added action item "Map the ice caves" to "Ridge patrol debrief"',
    },
    { t: localAt(yesterday, '12:00'), text: 'Closed "Order thermal blankets"' },
  );
  activity['p-echo'] = echo;
  return s;
}

import { describe, expect, it } from 'vitest';
import {
  buildDigest,
  type DigestRange,
  digestMarkdown,
  weekEnding,
} from '#shared/digest';
import { parseMarkdown } from '#shared/markdown';
import { emptySnapshot, type Snapshot, type Task } from '#shared/types';

// Mon 19 – Sun 25 Oct 2026, UTC (workerd runs in UTC).
const range: DigestRange = {
  from: '2026-10-19T00:00:00.000Z',
  to: '2026-10-26T00:00:00.000Z',
  fromDay: '2026-10-19',
  toDay: '2026-10-25',
};

function task(id: string, patch: Partial<Task>): Task {
  return {
    id,
    title: id,
    projectId: 'p1',
    status: 'open',
    priority: 'none',
    due: '',
    desc: '',
    tags: [],
    assignee: '',
    links: [],
    order: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    completedAt: null,
    ...patch,
  };
}

function world(): Snapshot {
  const s = emptySnapshot();
  s.projects.p1 = {
    id: 'p1',
    name: 'Echo Base',
    org: '',
    status: 'active',
    priority: 'none',
    targetDate: '',
    tags: [],
    desc: '',
    state: 'Shields up',
    members: [],
    links: [],
    archived: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
  s.projects.p2 = { ...s.projects.p1, id: 'p2', name: 'Quiet', state: '' };
  return s;
}

describe('buildDigest', () => {
  it('counts the week inclusively at the start and exclusively at the end', () => {
    const s = world();
    s.tasks.first = task('first', { status: 'done', completedAt: range.from });
    s.tasks.last = task('last', {
      status: 'done',
      completedAt: '2026-10-25T23:59:59.999Z',
    });
    s.tasks.after = task('after', { status: 'done', completedAt: range.to });
    s.tasks.before = task('before', {
      status: 'done',
      completedAt: '2026-10-18T23:59:59.999Z',
    });
    s.tasks.fresh = task('fresh', { createdAt: '2026-10-20T10:00:00.000Z' });
    const g = buildDigest(s, range).projects[0];
    expect(g?.closed.sort()).toEqual(['first', 'last']);
    expect(g?.added).toEqual(['fresh']);
  });

  it('meetings by local day, decisions, notes, and status / health lines', () => {
    const s = world();
    const meeting = (id: string, date: string) => ({
      id,
      projectId: 'p1',
      title: id,
      date,
      time: '',
      end: '',
      attendees: [],
      link: '',
      note: '',
      createdAt: range.from,
      updatedAt: range.from,
    });
    s.meetings.a = meeting('Kickoff', '2026-10-19');
    s.meetings.b = meeting('Review', '2026-10-25');
    s.meetings.c = meeting('Too late', '2026-10-26');
    s.notes.n = {
      id: 'n',
      projectId: null,
      body: 'x',
      pinned: false,
      meetingId: null,
      phase: null,
      createdAt: '2026-10-21T08:00:00.000Z',
    };
    s.decisions.d = {
      id: 'd',
      projectId: 'p1',
      title: 'Move to Hoth',
      rationale: '',
      status: 'decided',
      decidedAt: '2026-10-22',
      deciders: [],
      links: [],
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: range.from,
    };
    s.activity.p1 = {
      events: [
        { t: '2026-10-23T09:00:00.000Z', text: 'Health set to red' },
        { t: '2026-10-22T09:00:00.000Z', text: 'Updated current state' },
        { t: '2026-10-20T09:00:00.000Z', text: 'Status changed to paused' },
        { t: '2026-10-10T09:00:00.000Z', text: 'Health set to green' },
      ],
    };
    const digest = buildDigest(s, range);
    expect(digest.projects.map((g) => g.name)).toEqual([
      'Echo Base',
      'General',
    ]);
    const echo = digest.projects[0];
    expect(echo?.meetings).toEqual([
      'Mon 19 Oct 2026: Kickoff',
      'Sun 25 Oct 2026: Review',
    ]);
    expect(echo?.decisions).toEqual(['Decided: Move to Hoth']);
    expect(echo?.changes).toEqual([
      'Status changed to paused',
      'Health set to red',
    ]);
    // The retired current state line is not in the digest.
    expect(digestMarkdown(digest)).not.toContain('Shields up');
    expect(digest.projects[1]?.notes).toBe(1);
    expect(digest.totals).toEqual({
      closed: 0,
      added: 0,
      notes: 1,
      decisions: 1,
    });
  });

  it('lists milestones this week and next, outside the archive', () => {
    const s = world();
    s.projects.p1 = {
      ...(s.projects.p1 as Snapshot['projects'][string]),
      milestones: [
        { id: 'm0', title: 'Before', date: '2026-10-18' },
        { id: 'm1', title: 'Shields up', date: '2026-10-19' },
        { id: 'm2', title: 'Doors hung', date: '2026-10-28' },
        { id: 'm3', title: 'Base operational', date: '2026-11-01' },
        { id: 'm4', title: 'Too far', date: '2026-11-02' },
      ],
    };
    s.projects.p3 = {
      ...(s.projects.p1 as Snapshot['projects'][string]),
      id: 'p3',
      name: 'Archived',
      archived: true,
      milestones: [{ id: 'm5', title: 'Hidden', date: '2026-10-20' }],
    };
    const digest = buildDigest(s, range);
    // A project with only milestones still gets its section.
    expect(digest.projects.map((g) => g.name)).toEqual(['Echo Base']);
    expect(digest.projects[0]?.milestones).toEqual([
      'Mon 19 Oct 2026: Shields up',
      'Wed 28 Oct 2026: Doors hung',
      'Sun 1 Nov 2026: Base operational',
    ]);
    expect(digestMarkdown(digest)).toContain(
      '- **Milestones:** Mon 19 Oct 2026: Shields up; Wed 28 Oct 2026: Doors hung; Sun 1 Nov 2026: Base operational',
    );
  });

  it('writes Markdown the renderer reads, and says when nothing happened', () => {
    const s = world();
    s.tasks.t = task('Fix the heaters', {
      status: 'done',
      completedAt: '2026-10-20T10:00:00.000Z',
    });
    const text = digestMarkdown(buildDigest(s, range));
    expect(text.split('\n')[0]).toBe(
      '## Week of Mon 19 Oct 2026 – Sun 25 Oct 2026',
    );
    expect(text).toContain('### Echo Base\n- **Closed:** Fix the heaters');
    const blocks = parseMarkdown(text);
    expect(blocks.filter((b) => b.t === 'h')).toHaveLength(2);
    expect(digestMarkdown(buildDigest(world(), range))).toContain(
      'Nothing happened this week.',
    );
  });

  it('weekEnding is the seven days ending that day', () => {
    expect(weekEnding('2026-10-25')).toMatchObject({
      fromDay: '2026-10-19',
      toDay: '2026-10-25',
      from: '2026-10-19T00:00:00.000Z',
      to: '2026-10-26T00:00:00.000Z',
    });
    // Across a month end.
    expect(weekEnding('2026-11-03').fromDay).toBe('2026-10-28');
  });
});

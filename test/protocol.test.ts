import { describe, expect, it } from 'vitest';
import { LIMITS } from '#shared/limits';
import {
  ClientMessageSchema,
  CreateSpaceSchema,
  DeleteSpaceSchema,
  DocumentSchemas,
  describeIssue,
  ExportSchema,
  MoveProjectSchema,
  OpSchema,
  RenameSpaceSchema,
  ReorderSpacesSchema,
  SpaceSchema,
} from '#shared/protocol';
import { COLLECTIONS, MAIN_SPACE } from '#shared/types';
import fixture from './fixtures/export.json';

const at = '2026-10-23T12:00:00.000Z';

/** One valid and one invalid document per collection. */
const cases = {
  projects: {
    valid: {
      id: 'p-1',
      name: 'Echo Base',
      org: 'Rebel Alliance',
      status: 'active',
      priority: 'high',
      targetDate: '2026-11-14',
      tags: ['infra'],
      desc: '',
      state: 'On track',
      members: ['u-1'],
      links: [{ type: 'doc', url: 'https://example.com', label: 'Plan' }],
      archived: false,
      createdAt: at,
      updatedAt: at,
    },
    invalid: { id: 'p-1', name: '', createdAt: at, updatedAt: at },
  },
  tasks: {
    valid: {
      id: 't-1',
      title: 'Fix the heaters',
      projectId: null,
      status: 'open',
      priority: 'none',
      due: '',
      desc: '',
      tags: [],
      assignee: '',
      links: [],
      order: 1,
      createdAt: at,
      updatedAt: at,
      completedAt: null,
    },
    invalid: {
      id: 't-1',
      title: 'Fix the heaters',
      status: 'blocked',
      createdAt: at,
      updatedAt: at,
    },
  },
  notes: {
    valid: {
      id: 'n-1',
      projectId: 'p-1',
      body: 'Hello @{u-1}',
      pinned: false,
      meetingId: 'e-1',
      phase: 'pre',
      createdAt: at,
    },
    invalid: { id: 'n-1', body: 'x', phase: 'during', createdAt: at },
  },
  meetings: {
    valid: {
      id: 'e-1',
      projectId: null,
      title: 'Review',
      date: '2026-10-27',
      time: '14:00',
      end: '',
      attendees: [],
      link: '',
      note: '',
      createdAt: at,
      updatedAt: at,
    },
    invalid: {
      id: 'e-1',
      title: 'Review',
      date: '2026-02-30',
      createdAt: at,
      updatedAt: at,
    },
  },
  people: {
    valid: { id: 'u-1', name: 'Leia Organa', role: 'General', me: true },
    invalid: { id: 'u-1', role: 'General' },
  },
  activity: {
    valid: { events: [{ t: at, text: 'Created project' }] },
    invalid: { events: [{ t: 'yesterday', text: 'Created project' }] },
  },
  settings: {
    valid: { defaultOrg: 'Rebel Alliance' },
    invalid: { defaultOrg: 'x'.repeat(LIMITS.nameMax + 1) },
  },
  templates: {
    valid: {
      id: 'tp-1',
      name: 'Kickoff',
      tasks: [{ title: 'Kickoff call', priority: 'high', tags: ['setup'] }],
      defaultTags: ['client'],
      createdAt: at,
      updatedAt: at,
    },
    invalid: {
      id: 'tp-1',
      name: 'Kickoff',
      tasks: [{ title: '' }],
      createdAt: at,
      updatedAt: at,
    },
  },
  orgs: {
    valid: {
      id: 'o-1',
      name: 'Rebel Alliance',
      kind: 'client',
      links: [],
      notes: '',
      contacts: ['u-1'],
      archived: false,
      createdAt: at,
      updatedAt: at,
    },
    invalid: {
      id: 'o-1',
      name: 'Rebels',
      kind: 'enemy',
      createdAt: at,
      updatedAt: at,
    },
  },
  decisions: {
    valid: {
      id: 'd-1',
      projectId: 'p-1',
      title: 'Move to Hoth',
      rationale: 'Further from the core',
      status: 'decided',
      decidedAt: '2026-10-20',
      deciders: ['u-1'],
      links: [],
      createdAt: at,
      updatedAt: at,
    },
    invalid: {
      id: 'd-1',
      title: 'Move to Hoth',
      status: 'maybe',
      createdAt: at,
      updatedAt: at,
    },
  },
} as const;

describe('document schemas', () => {
  for (const col of COLLECTIONS) {
    it(`accepts a valid ${col} document and refuses an invalid one`, () => {
      const schema = DocumentSchemas[col];
      expect(schema.safeParse(cases[col].valid).success).toBe(true);
      expect(schema.safeParse(cases[col].invalid).success).toBe(false);
    });
  }

  it('parses every document of a real export with zero errors', () => {
    // The artifact has no settings or decisions; Datapad adds those.
    for (const col of COLLECTIONS.filter(
      (c) =>
        c !== 'settings' &&
        c !== 'decisions' &&
        c !== 'orgs' &&
        c !== 'templates',
    )) {
      const docs = fixture[col] as Record<string, unknown>;
      expect(Object.keys(docs).length).toBeGreaterThan(0);
      for (const [key, doc] of Object.entries(docs)) {
        const result = DocumentSchemas[col].safeParse(doc);
        expect(result.error?.issues ?? [], `${col}.${key}`).toEqual([]);
        // Nothing is lost or added: the document comes back as it went in.
        expect(result.data).toEqual(doc);
      }
    }
  });

  it('strips unknown keys instead of refusing them', () => {
    const result = DocumentSchemas.people.parse({
      ...cases.people.valid,
      color: 'blue',
    });
    expect(result).toEqual(cases.people.valid);
  });

  it('fills fields an older export lacks with their empty value', () => {
    const task = DocumentSchemas.tasks.parse({
      id: 't-1',
      title: 'Old task',
      createdAt: at,
      updatedAt: at,
    });
    expect(task).toMatchObject({
      projectId: null,
      status: 'open',
      priority: 'none',
      due: '',
      assignee: '',
      tags: [],
      links: [],
      order: 0,
      completedAt: null,
    });
    expect(task).not.toHaveProperty('sourceNoteId');
  });

  it('keeps completedAt null while open, and optional fields optional', () => {
    const task = DocumentSchemas.tasks.parse(cases.tasks.valid);
    expect(task.completedAt).toBeNull();
    const note = DocumentSchemas.notes.parse(cases.notes.valid);
    expect(note).not.toHaveProperty('editedAt');
  });

  it('enforces the limits', () => {
    const long = 'x'.repeat(LIMITS.titleMax + 1);
    expect(
      DocumentSchemas.tasks.safeParse({ ...cases.tasks.valid, title: long })
        .success,
    ).toBe(false);
    const tags = Array.from({ length: LIMITS.tagsMax + 1 }, (_, i) => `t${i}`);
    expect(
      DocumentSchemas.projects.safeParse({ ...cases.projects.valid, tags })
        .success,
    ).toBe(false);
    expect(
      DocumentSchemas.notes.safeParse({
        ...cases.notes.valid,
        body: 'x'.repeat(LIMITS.bodyMax + 1),
      }).success,
    ).toBe(false);
  });

  it('checks dates, times and timestamps', () => {
    const event = DocumentSchemas.meetings;
    const base = cases.meetings.valid;
    expect(event.safeParse({ ...base, date: '2026-10-31' }).success).toBe(true);
    expect(event.safeParse({ ...base, date: '10/31/2026' }).success).toBe(
      false,
    );
    expect(event.safeParse({ ...base, time: '24:00' }).success).toBe(false);
    expect(event.safeParse({ ...base, end: '9:30' }).success).toBe(false);
    expect(event.safeParse({ ...base, createdAt: 'now' }).success).toBe(false);
    expect(
      event.safeParse({ ...base, createdAt: '2026-10-23T12:00:00+02:00' })
        .success,
    ).toBe(true);
  });
});

describe('milestones on a project', () => {
  const milestone = { id: 'm-1', title: 'Launch', date: '2026-11-14' };

  it('are optional, and checked when present', () => {
    const project = DocumentSchemas.projects;
    const base = cases.projects.valid;
    expect(project.parse(base)).not.toHaveProperty('milestones');
    expect(
      project.parse({ ...base, milestones: [milestone] }).milestones,
    ).toEqual([milestone]);
    expect(
      project.safeParse({
        ...base,
        milestones: [{ ...milestone, date: '2026-13-01' }],
      }).success,
    ).toBe(false);
    expect(
      project.safeParse({ ...base, milestones: [{ ...milestone, title: '' }] })
        .success,
    ).toBe(false);
    const many = Array.from({ length: LIMITS.milestonesMax + 1 }, (_, i) => ({
      ...milestone,
      id: `m-${i}`,
    }));
    expect(project.safeParse({ ...base, milestones: many }).success).toBe(
      false,
    );
  });
});

describe('the export file', () => {
  it('reads the artifact’s export', () => {
    const parsed = ExportSchema.parse(fixture);
    expect(Object.keys(parsed.projects)).toEqual(Object.keys(fixture.projects));
    expect(parsed.activity.general.events.length).toBe(2);
  });

  it('fills settings an export lacks with the defaults', () => {
    expect(DocumentSchemas.settings.parse({})).toEqual({ defaultOrg: '' });
    expect(ExportSchema.parse(fixture).settings).toEqual({});
  });

  it('reads collections given as arrays, and missing ones as empty', () => {
    const parsed = ExportSchema.parse({
      people: [cases.people.valid],
      activity: [{ id: 'general', events: [] }],
    });
    expect(parsed.people).toEqual({ 'u-1': cases.people.valid });
    expect(parsed.activity).toEqual({ general: { events: [] } });
    expect(parsed.tasks).toEqual({});
  });

  it('takes the map key as the id when a document has none', () => {
    const { id: _, ...person } = cases.people.valid;
    const parsed = ExportSchema.parse({ people: { 'u-9': person } });
    expect(parsed.people['u-9']?.id).toBe('u-9');
  });

  it('says where the first problem is', () => {
    const result = ExportSchema.safeParse({
      tasks: { 't-1': cases.tasks.invalid },
    });
    expect(result.success).toBe(false);
    const issue = result.error?.issues[0];
    expect(issue?.path).toEqual(['tasks', 't-1', 'status']);
    expect(issue && describeIssue(issue)).toBe(
      'Status must be one of open, done',
    );
  });
});

describe('ops and messages', () => {
  it('accepts a well-formed op and trims its text', () => {
    const op = OpSchema.parse({
      type: 'addTask',
      id: 't-9',
      projectId: null,
      title: '  Fix the heaters  ',
    });
    expect(op).toEqual({
      type: 'addTask',
      id: 't-9',
      projectId: null,
      title: 'Fix the heaters',
    });
  });

  it('has meeting and milestone ops, and no event ops', () => {
    expect(
      OpSchema.parse({
        type: 'addMilestone',
        projectId: 'p-1',
        id: 'm-1',
        title: '  Launch ',
        date: '2026-11-14',
      }),
    ).toMatchObject({ title: 'Launch' });
    expect(
      OpSchema.safeParse({
        type: 'addMilestone',
        projectId: 'p-1',
        id: 'm-1',
        title: 'Launch',
        date: '2026-02-30',
      }).success,
    ).toBe(false);
    expect(
      OpSchema.safeParse({
        type: 'editMilestone',
        projectId: 'p-1',
        id: 'm-1',
        patch: {},
      }).success,
    ).toBe(false);
    expect(
      OpSchema.safeParse({
        type: 'deleteMilestone',
        projectId: 'p-1',
        id: 'm-1',
      }).success,
    ).toBe(true);
    expect(
      OpSchema.safeParse({
        type: 'addMeeting',
        id: 'e-9',
        projectId: null,
        title: 'Standup',
        date: '2026-10-27',
      }).success,
    ).toBe(true);
    expect(
      OpSchema.safeParse({ type: 'deleteMeeting', id: 'e-9' }).success,
    ).toBe(true);
    for (const type of ['addEvent', 'editEvent', 'deleteEvent']) {
      expect(OpSchema.safeParse({ type, id: 'e-9' }).success).toBe(false);
    }
    expect(
      OpSchema.safeParse({
        type: 'put',
        col: 'events',
        doc: cases.meetings.valid,
      }).success,
    ).toBe(false);
  });

  it('refuses an unknown op, an empty title and an empty patch', () => {
    expect(OpSchema.safeParse({ type: 'wipeAll' }).success).toBe(false);
    expect(
      OpSchema.safeParse({
        type: 'addTask',
        id: 't-9',
        projectId: null,
        title: '   ',
      }).success,
    ).toBe(false);
    expect(
      OpSchema.safeParse({ type: 'editTask', id: 't-1', patch: {} }).success,
    ).toBe(false);
  });

  it('validates the whole document in put', () => {
    expect(
      OpSchema.safeParse({
        type: 'put',
        col: 'tasks',
        doc: cases.tasks.valid,
      }).success,
    ).toBe(true);
    expect(
      OpSchema.safeParse({
        type: 'put',
        col: 'tasks',
        doc: cases.people.valid,
      }).success,
    ).toBe(false);
  });

  it('takes a batch of ops, not nested, within the limit', () => {
    const one = { type: 'deleteTask', id: 't-1' };
    expect(OpSchema.safeParse({ type: 'batch', ops: [one, one] }).success).toBe(
      true,
    );
    expect(
      OpSchema.safeParse({
        type: 'batch',
        ops: [{ type: 'batch', ops: [one] }],
      }).success,
    ).toBe(false);
    expect(
      OpSchema.safeParse({
        type: 'batch',
        ops: Array.from({ length: LIMITS.batchMax + 1 }, () => one),
      }).success,
    ).toBe(false);
  });

  it('wraps ops in client messages', () => {
    expect(
      ClientMessageSchema.safeParse({
        type: 'op',
        opId: 'o-1',
        op: { type: 'deleteTask', id: 't-1' },
      }).success,
    ).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: 'sync' }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: 'hello' }).success).toBe(
      false,
    );
  });

  it('describes problems in words', () => {
    const result = OpSchema.safeParse({
      type: 'addTask',
      id: 't-9',
      projectId: null,
      title: 'x'.repeat(LIMITS.titleMax + 1),
    });
    const issue = result.error?.issues[0];
    expect(issue && describeIssue(issue)).toBe(
      `Title is too long (${LIMITS.titleMax} characters at most)`,
    );
  });
});

describe('spaces', () => {
  const main = { id: MAIN_SPACE, name: 'Main', position: 0, createdAt: at };

  it('takes a space and trims its name', () => {
    expect(SpaceSchema.parse({ ...main, name: '  Main  ' })).toEqual(main);
  });

  it('refuses a space with a blank, long or missing name', () => {
    for (const name of ['', '   ', 'x'.repeat(LIMITS.spaceNameMax + 1)]) {
      expect(SpaceSchema.safeParse({ ...main, name }).success).toBe(false);
    }
    const { name: _, ...nameless } = main;
    expect(SpaceSchema.safeParse(nameless).success).toBe(false);
  });

  it('refuses a bad position or created time', () => {
    for (const position of [-1, 1.5]) {
      expect(SpaceSchema.safeParse({ ...main, position }).success).toBe(false);
    }
    expect(
      SpaceSchema.safeParse({ ...main, createdAt: 'yesterday' }).success,
    ).toBe(false);
  });

  it('checks create and rename names the same way', () => {
    expect(CreateSpaceSchema.parse({ name: ' Hoth ' })).toEqual({
      name: 'Hoth',
    });
    expect(CreateSpaceSchema.safeParse({ name: ' ' }).success).toBe(false);
    expect(RenameSpaceSchema.parse({ id: 's-1', name: 'Hoth ' })).toEqual({
      id: 's-1',
      name: 'Hoth',
    });
    expect(RenameSpaceSchema.safeParse({ name: 'Hoth' }).success).toBe(false);
    const long = CreateSpaceSchema.safeParse({
      name: 'x'.repeat(LIMITS.spaceNameMax + 1),
    });
    const issue = long.error?.issues[0];
    expect(issue && describeIssue(issue)).toBe(
      `Name is too long (${LIMITS.spaceNameMax} characters at most)`,
    );
  });

  it('reorders every space once, within the limit', () => {
    expect(
      ReorderSpacesSchema.safeParse({ ids: [MAIN_SPACE, 's-1'] }).success,
    ).toBe(true);
    expect(ReorderSpacesSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(
      ReorderSpacesSchema.safeParse({ ids: ['s-1', MAIN_SPACE, 's-1'] })
        .success,
    ).toBe(false);
    expect(
      ReorderSpacesSchema.safeParse({
        ids: Array.from({ length: LIMITS.spacesMax + 1 }, (_, i) => `s-${i}`),
      }).success,
    ).toBe(false);
  });

  it('needs a token to delete', () => {
    expect(
      DeleteSpaceSchema.safeParse({ id: 's-1', token: 'abc123' }).success,
    ).toBe(true);
    expect(DeleteSpaceSchema.safeParse({ id: 's-1' }).success).toBe(false);
    expect(DeleteSpaceSchema.safeParse({ id: 's-1', token: '' }).success).toBe(
      false,
    );
  });

  it('moves a project between two different spaces', () => {
    expect(
      MoveProjectSchema.parse({ from: MAIN_SPACE, to: 's-1', id: 'p-1' }),
    ).toEqual({ from: MAIN_SPACE, to: 's-1', id: 'p-1' });
    const same = MoveProjectSchema.safeParse({
      from: 's-1',
      to: 's-1',
      id: 'p-1',
    });
    expect(same.success).toBe(false);
    expect(same.error?.issues[0]?.path).toEqual(['to']);
    expect(
      MoveProjectSchema.safeParse({ from: MAIN_SPACE, to: 's-1' }).success,
    ).toBe(false);
  });
});

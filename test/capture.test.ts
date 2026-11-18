import { describe, expect, it } from 'vitest';
import {
  canSave,
  captureChips,
  captureOps,
  captureToast,
  hashQuery,
  nextKind,
  parseCapture,
  projectWord,
  undoCaptureOp,
} from '#shared/capture';
import { addDays } from '#shared/dates';
import { reduce } from '#shared/reducer';
import {
  emptySnapshot,
  type Person,
  type Project,
  SETTINGS_ID,
  type Snapshot,
} from '#shared/types';

/** The capture line's parser (#330). Monday 16 November 2026. */
const TODAY = '2026-11-16';
const NOW = '2026-11-16T12:00:00.000Z';

function person(id: string, name: string, me = false): Person {
  return { id, name, role: '', me };
}

function project(id: string, name: string, archived = false): Project {
  return {
    id,
    name,
    org: '',
    status: 'active',
    priority: 'med',
    startDate: '',
    targetDate: '',
    desc: '',
    state: '',
    tags: [],
    members: [],
    links: [],
    milestones: [],
    archived,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function snapshot(): Snapshot {
  const s = emptySnapshot();
  s.people = {
    han: person('han', 'Han Solo'),
    chewie: person('chewie', 'Chewbacca'),
    leia: person('leia', 'Leia', true),
  };
  s.projects = {
    falcon: project('falcon', 'Falcon Refit'),
    fleet: project('fleet', 'Fleet Ops'),
    echo: project('echo', 'Echo Base'),
    old: project('old', 'Endor', true),
  };
  return s;
}

const parse = (
  text: string,
  context = {},
  force?: Parameters<typeof parseCapture>[4],
  state = snapshot(),
) => parseCapture(text, state, TODAY, context, force);

describe('parseCapture: kinds', () => {
  it('reads a plain line as a note, to Scratch', () => {
    const c = parse('The hyperdrive hums at idle');
    expect(c).toMatchObject({
      kind: 'note',
      text: 'The hyperdrive hums at idle',
      projectId: null,
      due: '',
      toScratch: true,
    });
  });

  it('reads [ ], - [ ] and todo as a task', () => {
    for (const line of [
      '[ ] Patch the hull',
      '[] Patch the hull',
      '- [ ] Patch the hull',
      'todo Patch the hull',
      'todo: Patch the hull',
    ]) {
      expect(parse(line), line).toMatchObject({
        kind: 'task',
        text: 'Patch the hull',
      });
    }
  });

  it('reads a date as a task', () => {
    expect(parse('Patch the hull fri')).toMatchObject({
      kind: 'task',
      text: 'Patch the hull',
      due: '2026-11-20',
    });
  });

  it('reads ?, decide: and a closing ? as something to decide', () => {
    expect(parse('? Refit or replace')).toMatchObject({
      kind: 'decide',
      text: 'Refit or replace',
    });
    expect(parse('decide: refit or replace')).toMatchObject({
      kind: 'decide',
      text: 'refit or replace',
    });
    expect(parse('Decide on the new shields')).toMatchObject({
      kind: 'decide',
      text: 'Decide on the new shields',
    });
    expect(parse('Refit before the run?')).toMatchObject({
      kind: 'decide',
      text: 'Refit before the run?',
    });
  });

  it('lets an explicit [ ] win over a closing ?', () => {
    expect(parse('[ ] Ask about the parts?').kind).toBe('task');
  });

  it('reads waiting on @Name as a task blocked on them', () => {
    const c = parse('waiting on @Chewbacca the parts list');
    expect(c).toMatchObject({
      kind: 'wait',
      text: 'the parts list',
      waitingOn: 'chewie',
      people: ['chewie'],
    });
    expect(parse('Waiting for @Han Solo').waitingOn).toBe('han');
  });

  it('forces a kind; a forced note keeps its date words', () => {
    expect(parse('Patch the hull fri', {}, 'note')).toMatchObject({
      kind: 'note',
      text: 'Patch the hull fri',
      due: '',
    });
    expect(parse('The hyperdrive', {}, 'task').kind).toBe('task');
    expect(parse('The hyperdrive', {}, 'decide').kind).toBe('decide');
    expect(parse('[ ] The hyperdrive fri', {}, 'wait')).toMatchObject({
      kind: 'wait',
      due: '2026-11-20',
    });
  });

  it('cycles kinds for the chip', () => {
    expect(nextKind('note')).toBe('task');
    expect(nextKind('task')).toBe('decide');
    expect(nextKind('decide')).toBe('wait');
    expect(nextKind('wait')).toBe('note');
  });
});

describe('parseCapture: # and @', () => {
  it('files under the project a unique prefix names', () => {
    const c = parse('Order the coils #falc');
    expect(c).toMatchObject({
      projectId: 'falcon',
      text: 'Order the coils',
      toScratch: false,
    });
    expect(parse('#echobase check the doors').projectId).toBe('echo');
    expect(parse('Check it #FalconRefit.').text).toBe('Check it .');
  });

  it('leaves an ambiguous or unknown # as typed', () => {
    const ambiguous = parse('Check #f');
    expect(ambiguous.projectId).toBeNull();
    expect(ambiguous.text).toBe('Check #f');
    const unknown = parse('Check #tatooine');
    expect(unknown.projectId).toBeNull();
    expect(unknown.text).toBe('Check #tatooine');
  });

  it('prefers an exact name over a longer one it starts', () => {
    const state = snapshot();
    state.projects.fal = project('fal', 'Fal');
    expect(parse('Check #fal', {}, undefined, state).projectId).toBe('fal');
  });

  it('skips archived projects', () => {
    expect(parse('Check #endor').projectId).toBeNull();
  });

  it('takes the first project only', () => {
    expect(parse('#falcon and #fleet').projectId).toBe('falcon');
    expect(parse('#falcon and #fleet').text).toBe('and #fleet');
  });

  it('mentions people; a mention files a note', () => {
    const c = parse('Talked to @Han Solo about the coils');
    expect(c).toMatchObject({
      kind: 'note',
      text: 'Talked to @{han} about the coils',
      people: ['han'],
      toScratch: false,
    });
  });

  it('assigns a task or a decision to the first person named', () => {
    expect(parse('[ ] Fix the coils @Chewbacca').assignee).toBe('chewie');
    expect(parse('? Which coils @Han Solo').assignee).toBe('han');
  });

  it('leaves an unknown @name as text', () => {
    const c = parse('[ ] Ask @Lando');
    expect(c.text).toBe('Ask @Lando');
    expect(c.people).toEqual([]);
    expect(c.assignee).toBe('');
  });

  it('gives an unnamed task to me when Settings says so', () => {
    const state = snapshot();
    state.settings[SETTINGS_ID] = {
      ...state.settings[SETTINGS_ID],
      defaultOrg: '',
      assignToMe: true,
    };
    expect(parse('[ ] Fix it', {}, undefined, state).assignee).toBe('leia');
    expect(parse('waiting on @Han Solo', {}, undefined, state)).toMatchObject({
      assignee: 'leia',
      waitingOn: 'han',
    });
  });
});

describe('parseCapture: dates', () => {
  it('reads plain dates anywhere', () => {
    expect(parse('Patch it tomorrow').due).toBe(addDays(TODAY, 1));
    expect(parse('Patch it next fri').due).toBe('2026-11-27');
    expect(parse('Patch it in 3 days').due).toBe(addDays(TODAY, 3));
    expect(parse('Patch it +2w').due).toBe(addDays(TODAY, 14));
    expect(parse('Patch it 12/1').due).toBe('2026-12-01');
    expect(parse('Patch it 2026-12-24').text).toBe('Patch it');
  });

  it('takes due, by or on out with the date', () => {
    expect(parse('Patch the hull by fri')).toMatchObject({
      text: 'Patch the hull',
      due: '2026-11-20',
    });
    expect(parse('Patch the hull due tomorrow').text).toBe('Patch the hull');
  });

  it('reads sat, sun, mon, wed, tod and tom only after due, by or on', () => {
    for (const word of ['sat', 'sun', 'mon', 'wed', 'tod', 'tom']) {
      const plain = parse(`Ask ${word} about it`);
      expect(plain.kind, word).toBe('note');
      expect(plain.due, word).toBe('');
      const due = parse(`Ask about it on ${word}`);
      expect(due.kind, word).toBe('task');
      expect(due.due, word).not.toBe('');
      expect(due.text, word).toBe('Ask about it');
    }
  });

  it('never reads now as a date', () => {
    expect(parse('Right now the coils hum').kind).toBe('note');
  });
});

describe('parseCapture: room context', () => {
  it('presets the project unless a # names another', () => {
    expect(parse('Check the coils', { projectId: 'fleet' }).projectId).toBe(
      'fleet',
    );
    expect(
      parse('Check the coils #falcon', { projectId: 'fleet' }).projectId,
    ).toBe('falcon');
  });

  it('presets the person: a note mentions them', () => {
    const c = parse('Likes the plan', { personId: 'han' });
    expect(c.text).toBe('Likes the plan @{han}');
    expect(c.people).toEqual(['han']);
    expect(c.toScratch).toBe(false);
  });

  it('presets the person: a task is theirs, a wait is on them', () => {
    expect(parse('[ ] Send the specs', { personId: 'han' }).assignee).toBe(
      'han',
    );
    expect(
      parse('[ ] Send the specs @Chewbacca', { personId: 'han' }).assignee,
    ).toBe('chewie');
    expect(parse('waiting on the specs', { personId: 'han' }).waitingOn).toBe(
      'han',
    );
  });

  it('ignores a room that is gone', () => {
    expect(
      parse('Hello', { projectId: 'nope', personId: 'nope' }),
    ).toMatchObject({ projectId: null, people: [], toScratch: true });
  });
});

describe('saving a capture', () => {
  const save = (text: string, context = {}) => {
    const state = snapshot();
    const capture = parse(text, context, undefined, state);
    const ops = captureOps(capture, state, 'new');
    const op = ops.length === 1 ? ops[0] : { type: 'batch' as const, ops };
    if (!op) throw new Error('no op');
    return { capture, state: reduce(state, op, NOW).state };
  };

  it('adds a note with its project and mentions', () => {
    const { state } = save('Coils hum #falcon @Han Solo');
    expect(state.notes.new).toMatchObject({
      projectId: 'falcon',
      body: 'Coils hum @{han}',
    });
  });

  it('adds a task with its project, assignee, due and priority', () => {
    const { state } = save('[ ] Fix the coils @Chewbacca #fleet by fri');
    expect(state.tasks.new).toMatchObject({
      title: 'Fix the coils Chewbacca',
      projectId: 'fleet',
      assignee: 'chewie',
      due: '2026-11-20',
      priority: 'med',
    });
    expect(state.tasks.new?.decide).toBeUndefined();
  });

  it('adds something to decide', () => {
    const { state } = save('? Refit or replace #falcon');
    expect(state.tasks.new).toMatchObject({
      title: 'Refit or replace',
      decide: true,
    });
  });

  it('adds a task blocked on the person in one batch', () => {
    const { state } = save('waiting on @Chewbacca the parts list');
    expect(state.tasks.new).toMatchObject({
      title: 'the parts list',
      blocked: { on: 'chewie', note: '' },
    });
    const { state: bare } = save('waiting on @Chewbacca');
    expect(bare.tasks.new?.title).toBe('Hear back from Chewbacca');
  });

  it('undoes what it saved', () => {
    const { capture, state } = save('[ ] Fix the coils');
    const undone = reduce(state, undoCaptureOp(capture.kind, 'new'), NOW);
    expect(undone.state.tasks.new).toBeUndefined();
    const note = save('A thought');
    const gone = reduce(note.state, undoCaptureOp('note', 'new'), NOW);
    expect(gone.state.notes.new).toBeUndefined();
  });

  it('needs something to save', () => {
    const state = snapshot();
    expect(canSave(parse(''), state)).toBe(false);
    expect(canSave(parse('[ ] '), state)).toBe(false);
    expect(canSave(parse('#falcon'), state)).toBe(false);
    expect(canSave(parse('Hi'), state)).toBe(true);
  });
});

describe('chips and the toast', () => {
  it('says the kind, project, people, date and Scratch', () => {
    const state = snapshot();
    const chips = (text: string, context = {}) =>
      captureChips(parse(text, context), state, TODAY).map((c) => c.label);
    expect(chips('A thought')).toEqual(['Note', 'Scratch']);
    expect(chips('[ ] Fix it @Han Solo #falcon fri')).toEqual([
      'Task',
      'Falcon Refit',
      'for Han Solo',
      'Due Fri 20 Nov',
    ]);
    // No date in the line: due a week out, the default.
    expect(chips('waiting on @Chewbacca parts')).toEqual([
      'Waiting on',
      'waiting on Chewbacca',
      'Due Mon 23 Nov',
    ]);
    expect(chips('[ ] Fix it @Leia')).toEqual([
      'Task',
      'for you',
      'Due Mon 23 Nov',
    ]);
    expect(chips('Saw @Han Solo and @Leia')).toEqual([
      'Note',
      '@Han Solo',
      '@Leia',
    ]);
  });

  it('says where it went', () => {
    const state = snapshot();
    const toast = (text: string) => captureToast(parse(text), state);
    expect(toast('A thought')).toBe('Added a note to Scratch');
    expect(toast('A thought #falcon')).toBe('Added a note to Falcon Refit');
    expect(toast('Saw @Han Solo')).toBe('Added a note about Han Solo');
    expect(toast('[ ] Fix it')).toBe('Added a task to General');
    expect(toast('? Which #fleet')).toBe('Added to decide in Fleet Ops');
    expect(toast('waiting on @Chewbacca parts')).toBe(
      'Waiting on Chewbacca, in General',
    );
  });
});

describe('the # menu', () => {
  it('finds the #word being typed', () => {
    expect(hashQuery('Fix #fal', 8)).toEqual({ start: 4, query: 'fal' });
    expect(hashQuery('#', 1)).toEqual({ start: 0, query: '' });
    expect(hashQuery('a#b', 3)).toBeNull();
    expect(hashQuery('#fal done', 9)).toBeNull();
  });

  it('writes a picked project as one word', () => {
    expect(projectWord('Falcon Refit')).toBe('#FalconRefit');
    expect(parse(`Check ${projectWord('Echo Base')}`).projectId).toBe('echo');
  });
});

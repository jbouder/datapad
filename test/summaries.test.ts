import { describe, expect, it } from 'vitest';
import { eventContext } from '#shared/summaries';
import type { Event, Note, Project } from '#shared/types';

const event: Event = {
  id: 'e1',
  projectId: 'p1',
  title: 'Shield review',
  type: 'meeting',
  date: '2026-10-27',
  time: '14:00',
  end: '15:00',
  attendees: ['leia', 'gone'],
  link: '',
  note: 'Power budget.',
  createdAt: '2026-10-20T09:00:00.000Z',
  updatedAt: '2026-10-20T09:00:00.000Z',
};

function note(id: string, patch: Partial<Note>): Note {
  return {
    id,
    projectId: 'p1',
    body: id,
    pinned: false,
    eventId: 'e1',
    phase: null,
    createdAt: '2026-10-21T09:00:00.000Z',
    ...patch,
  };
}

describe('eventContext', () => {
  it('labels linked notes [prep] and [debrief], oldest first, names for mentions', () => {
    const text = eventContext(event, {
      projects: { p1: { id: 'p1', name: 'Echo Base' } as Project },
      people: { leia: { id: 'leia', name: 'Leia Organa', role: '', me: true } },
      notes: {
        b: note('b', {
          phase: 'post',
          body: 'Went well, ask @{leia}',
          createdAt: '2026-10-27T16:00:00.000Z',
        }),
        a: note('a', { phase: 'pre', body: 'Bring the numbers' }),
        c: note('c', { createdAt: '2026-10-28T08:00:00.000Z' }),
        other: note('other', { eventId: 'e2', body: 'Not this one' }),
      },
    });
    expect(text).toBe(
      [
        'Event: Shield review',
        'Type: Meeting',
        'Date: Tue 27 Oct 2026, 14:00–15:00',
        'Project: Echo Base',
        'Attendees: Leia Organa',
        'Agenda: Power budget.',
        '',
        'Linked notes:',
        '[prep] Wed 21 Oct 2026',
        'Bring the numbers',
        '',
        '[debrief] Tue 27 Oct 2026',
        'Went well, ask @Leia Organa',
        '',
        '[note] Wed 28 Oct 2026',
        'c',
      ].join('\n'),
    );
  });

  it('says General and no attendees when there are none', () => {
    const text = eventContext(
      { ...event, projectId: null, attendees: [], note: '' },
      { projects: {}, people: {}, notes: {} },
    );
    expect(text).toContain('Project: General');
    expect(text).toContain('Attendees: none listed');
    expect(text).not.toContain('Agenda');
    expect(text).not.toContain('Linked notes');
  });
});

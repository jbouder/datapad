import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DECISION_FILTERS,
  projectDecisions,
  selectDecisions,
} from '#shared/decisions';
import type { Decision, Project } from '#shared/types';

function decision(id: string, patch: Partial<Decision> = {}): Decision {
  return {
    id,
    projectId: 'p1',
    title: id,
    rationale: '',
    status: 'decided',
    decidedAt: '',
    deciders: [],
    links: [],
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    ...patch,
  };
}

const projects = {
  p1: { id: 'p1', name: 'Echo Base' } as Project,
  p2: { id: 'p2', name: 'Alpha' } as Project,
};

const decisions = {
  old: decision('old', { decidedAt: '2026-09-01' }),
  new: decision('new', { decidedAt: '2026-10-20', rationale: 'Shields' }),
  raised: decision('raised', {
    status: 'proposed',
    createdAt: '2026-10-10T09:00:00.000Z',
  }),
  alpha: decision('alpha', { projectId: 'p2' }),
  general: decision('general', { projectId: null }),
};

describe('decisions', () => {
  it('a project lists its own, newest first (decided date, else raised)', () => {
    expect(projectDecisions(decisions, 'p1').map((x) => x.id)).toEqual([
      'new',
      'raised',
      'old',
    ]);
  });

  it('groups by project name, General last, and filters', () => {
    const all = selectDecisions(
      { decisions, projects },
      DEFAULT_DECISION_FILTERS,
    );
    expect(all.map((g) => g.label)).toEqual(['Alpha', 'Echo Base', 'General']);
    const proposed = selectDecisions(
      { decisions, projects },
      { ...DEFAULT_DECISION_FILTERS, status: 'proposed' },
    );
    expect(proposed.flatMap((g) => g.rows.map((x) => x.id))).toEqual([
      'raised',
    ]);
    const text = selectDecisions(
      { decisions, projects },
      { ...DEFAULT_DECISION_FILTERS, q: 'shield' },
    );
    expect(text.flatMap((g) => g.rows.map((x) => x.id))).toEqual(['new']);
    const general = selectDecisions(
      { decisions, projects },
      { ...DEFAULT_DECISION_FILTERS, project: 'general' },
    );
    expect(general.map((g) => g.id)).toEqual(['general']);
  });
});

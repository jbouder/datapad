import { describe, expect, it } from 'vitest';
import {
  canonicalQuery,
  parseRoute,
  type Route,
  routePath,
  sectionOf,
  titleOf,
} from '#shared/routes';

describe('parseRoute', () => {
  it('reads the simple pages', () => {
    for (const name of [
      'projects',
      'archive',
      'tasks',
      'notes',
      'meetings',
      'decisions',
      'digest',
    ] as const) {
      expect(parseRoute(`/${name}`)).toEqual({ name });
      expect(parseRoute(`/${name}/`)).toEqual({ name });
    }
  });

  it('sends the old Events address to Meetings', () => {
    expect(parseRoute('/events')).toEqual({ name: 'meetings' });
    expect(parseRoute('/events/')).toEqual({ name: 'meetings' });
  });

  it('reads Focus, projects, people, orgs, settings and help', () => {
    expect(parseRoute('/')).toEqual({ name: 'focus' });
    expect(parseRoute('/focus')).toEqual({ name: 'focus' });
    expect(parseRoute('/projects/p%201')).toEqual({
      name: 'project',
      id: 'p 1',
    });
    expect(parseRoute('/settings/people/x')).toEqual({
      name: 'people',
      person: 'x',
    });
    expect(parseRoute('/orgs')).toEqual({ name: 'orgs' });
    expect(parseRoute('/settings')).toEqual({
      name: 'settings',
      section: 'appearance',
    });
    expect(parseRoute('/settings/nope')).toEqual({ name: 'notFound' });
    expect(parseRoute('/help', '#keyboard')).toEqual({
      name: 'help',
      section: 'keyboard',
    });
  });

  it('admits the dev page only when asked', () => {
    expect(parseRoute('/dev/components')).toEqual({ name: 'notFound' });
    expect(parseRoute('/dev/components', '', true)).toEqual({
      name: 'devComponents',
    });
  });

  it('does not know anything else', () => {
    expect(parseRoute('/event')).toEqual({ name: 'notFound' });
    expect(parseRoute('/meetings/x')).toEqual({ name: 'notFound' });
  });
});

describe('routePath', () => {
  it('round-trips through parseRoute', () => {
    const routes: Route[] = [
      { name: 'focus' },
      { name: 'meetings' },
      { name: 'tasks' },
      { name: 'project', id: 'a/b' },
      { name: 'people', person: 'p1' },
      { name: 'orgs', org: 'o1' },
      { name: 'settings', section: 'spaces' },
      { name: 'settings', section: 'appearance' },
    ];
    for (const route of routes) {
      const path = routePath(route);
      expect(path).not.toBeNull();
      expect(parseRoute(path as string)).toEqual(route);
    }
  });

  it('puts Meetings at /meetings', () => {
    expect(routePath({ name: 'meetings' })).toBe('/meetings');
    expect(routePath(parseRoute('/events'))).toBe('/meetings');
  });

  it('leaves Not found where it is', () => {
    expect(routePath({ name: 'notFound' })).toBeNull();
  });
});

describe('canonicalQuery', () => {
  it('turns ?event= into ?meeting= on the old address', () => {
    expect(canonicalQuery('/events', '?view=list&event=e-1')).toBe(
      '?view=list&meeting=e-1',
    );
    expect(canonicalQuery('/events/', '?event=e-1')).toBe('?meeting=e-1');
  });

  it('keeps every other parameter', () => {
    expect(canonicalQuery('/events', '?project=p1&view=calendar')).toBe(
      '?project=p1&view=calendar',
    );
    expect(canonicalQuery('/events', '')).toBe('');
  });

  it('does not touch other pages', () => {
    expect(canonicalQuery('/meetings', '?event=e-1')).toBe('?event=e-1');
    expect(canonicalQuery('/notes', '?note=n1')).toBe('?note=n1');
  });
});

describe('sectionOf and titleOf', () => {
  it('puts a project and the archive under Projects', () => {
    expect(sectionOf({ name: 'project', id: 'p' })).toBe('projects');
    expect(sectionOf({ name: 'archive' })).toBe('projects');
    expect(sectionOf({ name: 'meetings' })).toBe('meetings');
    expect(sectionOf(parseRoute('/events'))).toBe('meetings');
  });

  it('titles the pages', () => {
    expect(titleOf({ name: 'meetings' })).toBe('Meetings');
    expect(titleOf({ name: 'project', id: 'p' }, 'Alpha')).toBe('Alpha');
    expect(titleOf({ name: 'project', id: 'p' })).toBe('Project');
    expect(titleOf({ name: 'digest' })).toBe('Weekly digest');
  });
});

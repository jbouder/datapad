import { describe, expect, it } from 'vitest';
import {
  canonicalQuery,
  parseRoute,
  type Route,
  routePath,
  SETTINGS_SECTIONS,
  sectionOf,
  settingsRoute,
  settingsSectionOf,
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
      { name: 'people' },
      { name: 'people', person: 'p1' },
      { name: 'orgs' },
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

  it('puts People and Orgs under Settings', () => {
    expect(routePath({ name: 'people' })).toBe('/settings/people');
    expect(routePath({ name: 'people', person: 'p 1' })).toBe(
      '/settings/people/p%201',
    );
    expect(routePath({ name: 'orgs' })).toBe('/settings/orgs');
    expect(routePath({ name: 'orgs', org: 'o1' })).toBe('/settings/orgs/o1');
  });

  it('sends the #93 addresses to Settings', () => {
    expect(routePath(parseRoute('/people'))).toBe('/settings/people');
    expect(routePath(parseRoute('/people/u-1'))).toBe('/settings/people/u-1');
    expect(routePath(parseRoute('/orgs'))).toBe('/settings/orgs');
    expect(routePath(parseRoute('/orgs/o-1/'))).toBe('/settings/orgs/o-1');
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

  it('puts People and Orgs under Settings', () => {
    expect(sectionOf({ name: 'people', person: 'p' })).toBe('settings');
    expect(sectionOf({ name: 'orgs' })).toBe('settings');
    expect(sectionOf({ name: 'settings', section: 'data' })).toBe('settings');
  });

  it('titles the pages', () => {
    expect(titleOf({ name: 'meetings' })).toBe('Meetings');
    expect(titleOf({ name: 'project', id: 'p' }, 'Alpha')).toBe('Alpha');
    expect(titleOf({ name: 'project', id: 'p' })).toBe('Project');
    expect(titleOf({ name: 'digest' })).toBe('Weekly digest');
    expect(titleOf({ name: 'people', person: 'p' })).toBe('People');
    expect(titleOf({ name: 'orgs' })).toBe('Orgs');
  });
});

describe('Settings sections', () => {
  it('lists People and Orgs after Spaces, before Data', () => {
    expect(SETTINGS_SECTIONS).toEqual([
      'appearance',
      'templates',
      'summaries',
      'spaces',
      'people',
      'orgs',
      'data',
      'account',
    ]);
  });

  it('round-trips each section through its route', () => {
    for (const section of SETTINGS_SECTIONS) {
      const route = settingsRoute(section);
      expect(settingsSectionOf(route)).toBe(section);
      expect(parseRoute(routePath(route) as string)).toEqual(route);
    }
    expect(settingsRoute('people')).toEqual({ name: 'people' });
    expect(settingsSectionOf({ name: 'tasks' })).toBeNull();
  });
});

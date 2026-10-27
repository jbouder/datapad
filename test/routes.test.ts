import { describe, expect, it } from 'vitest';
import {
  canonicalQuery,
  linkedMeeting,
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
      'digest',
    ] as const) {
      expect(parseRoute(`/${name}`)).toEqual({ name });
      expect(parseRoute(`/${name}/`)).toEqual({ name });
    }
  });

  it('sends the retired Decisions addresses to Focus', () => {
    expect(parseRoute('/decisions')).toEqual({ name: 'focus' });
    expect(parseRoute('/decisions/')).toEqual({ name: 'focus' });
    expect(parseRoute('/decisions/d-1')).toEqual({ name: 'focus' });
    expect(routePath(parseRoute('/decisions'))).toBe('/');
    expect(parseRoute('/decisionsx')).toEqual({ name: 'notFound' });
    expect(canonicalQuery('/decisions', '?decision=d-1')).toBe('');
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
    expect(parseRoute('/meetings/x/y')).toEqual({ name: 'notFound' });
    expect(parseRoute('/tasks/x/y')).toEqual({ name: 'notFound' });
  });
});

describe('routePath', () => {
  it('round-trips through parseRoute', () => {
    const routes: Route[] = [
      { name: 'focus' },
      { name: 'meetings' },
      { name: 'tasks' },
      { name: 'project', id: 'a/b' },
      { name: 'meeting', id: 'e 1' },
      { name: 'task', id: 't 1' },
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

  it('puts Meetings at /meetings, and each meeting under it', () => {
    expect(routePath({ name: 'meetings' })).toBe('/meetings');
    expect(routePath({ name: 'meeting', id: 'e-1' })).toBe('/meetings/e-1');
    expect(parseRoute('/meetings/e-1/')).toEqual({
      name: 'meeting',
      id: 'e-1',
    });
    expect(routePath(parseRoute('/events'))).toBe('/meetings');
  });

  it('puts each task under Tasks', () => {
    expect(routePath({ name: 'task', id: 't-1' })).toBe('/tasks/t-1');
    expect(parseRoute('/tasks/t-1/')).toEqual({ name: 'task', id: 't-1' });
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

describe('linkedMeeting', () => {
  it('reads the meeting an old link opened', () => {
    expect(linkedMeeting('/meetings', '?view=list&meeting=e-1')).toBe('e-1');
    expect(linkedMeeting('/events', '?event=e-1')).toBe('e-1');
    expect(linkedMeeting('/events/', '?view=list&event=e%201')).toBe('e 1');
  });

  it('is null without one, or anywhere else', () => {
    expect(linkedMeeting('/meetings', '?view=calendar')).toBeNull();
    expect(linkedMeeting('/meetings', '')).toBeNull();
    expect(linkedMeeting('/notes', '?meeting=e-1')).toBeNull();
    expect(linkedMeeting('/meetings/e-1', '?meeting=e-2')).toBeNull();
  });
});

describe('whiteboards', () => {
  it('reads and writes the space board and a project board', () => {
    expect(parseRoute('/whiteboard')).toEqual({ name: 'whiteboard' });
    expect(parseRoute('/whiteboard/')).toEqual({ name: 'whiteboard' });
    expect(parseRoute('/projects/p%201/whiteboard')).toEqual({
      name: 'whiteboard',
      project: 'p 1',
    });
    expect(routePath({ name: 'whiteboard' })).toBe('/whiteboard');
    expect(routePath({ name: 'whiteboard', project: 'p 1' })).toBe(
      '/projects/p%201/whiteboard',
    );
    expect(parseRoute('/projects/p/whiteboard/x')).toEqual({
      name: 'notFound',
    });
  });

  it('puts a project board under Projects and titles both', () => {
    expect(sectionOf({ name: 'whiteboard', project: 'p' })).toBe('projects');
    expect(sectionOf({ name: 'whiteboard' })).toBe('whiteboard');
    expect(titleOf({ name: 'whiteboard' })).toBe('Whiteboard');
    expect(titleOf({ name: 'whiteboard', project: 'p' })).toBe('Whiteboard');
  });
});

describe('sectionOf and titleOf', () => {
  it('puts a project and the archive under Projects, a task under Tasks, a meeting under Meetings', () => {
    expect(sectionOf({ name: 'project', id: 'p' })).toBe('projects');
    expect(sectionOf({ name: 'archive' })).toBe('projects');
    expect(sectionOf({ name: 'meetings' })).toBe('meetings');
    expect(sectionOf({ name: 'meeting', id: 'e' })).toBe('meetings');
    expect(sectionOf({ name: 'task', id: 't' })).toBe('tasks');
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
    expect(titleOf({ name: 'meeting', id: 'e' }, 'Standup')).toBe('Standup');
    expect(titleOf({ name: 'meeting', id: 'e' })).toBe('Meeting');
    expect(titleOf({ name: 'task', id: 't' }, 'Fix it')).toBe('Fix it');
    expect(titleOf({ name: 'task', id: 't' })).toBe('Task');
    expect(titleOf({ name: 'digest' })).toBe('Weekly digest');
    expect(titleOf({ name: 'people', person: 'p' })).toBe('People');
    expect(titleOf({ name: 'orgs' })).toBe('Orgs');
  });
});

describe('Settings sections', () => {
  it('lists Pages after Appearance, People and Orgs after Spaces', () => {
    expect(SETTINGS_SECTIONS).toEqual([
      'appearance',
      'pages',
      'navigation',
      'templates',
      'summaries',
      'spaces',
      'people',
      'orgs',
      'data',
      'account',
    ]);
  });

  it('parses Navigation (#187)', () => {
    expect(parseRoute('/settings/navigation')).toEqual({
      name: 'settings',
      section: 'navigation',
    });
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

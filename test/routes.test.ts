import { describe, expect, it } from 'vitest';
import {
  BOARD_ITEM_PARAM,
  boardItemLink,
  boardRoute,
  landRoute,
  parseRoute,
  placeOf,
  type Route,
  routeHref,
  routePath,
  routeSearch,
  SETTINGS_SECTIONS,
  settingsRoute,
  settingsSectionOf,
  taskRoom,
  titleOf,
} from '#shared/routes';

/** Where an address lands, as the address bar shows it after. */
function landsOn(address: string, hash = ''): string {
  const url = new URL(address, 'https://datapad.test');
  const [route, query] = landRoute(url.pathname, url.search, hash);
  return `${routePath(route)}${query}`;
}

describe('the v2 addresses (#329)', () => {
  it('reads Today, Unfiled and All', () => {
    expect(parseRoute('/')).toEqual({ name: 'today' });
    expect(parseRoute('/unfiled')).toEqual({ name: 'unfiled' });
    expect(parseRoute('/unfiled/')).toEqual({ name: 'unfiled' });
    expect(parseRoute('/all')).toEqual({ name: 'all' });
    expect(parseRoute('/all', '', false, '?kind=task')).toEqual({
      name: 'all',
      kinds: ['task'],
    });
    expect(parseRoute('/all', '', false, '?kind=nope')).toEqual({
      name: 'all',
    });
  });

  it('reads All’s kinds once each, in their order (#337)', () => {
    expect(
      parseRoute('/all', '', false, '?kind=person,task,nope,task'),
    ).toEqual({ name: 'all', kinds: ['task', 'person'] });
    expect(routeHref({ name: 'all', kinds: ['project', 'note'] })).toBe(
      '/all?kind=note,project',
    );
    expect(routeHref({ name: 'all', kinds: [] })).toBe('/all');
  });

  it('reads #329’s archived projects as All’s Archived status', () => {
    expect(landRoute('/all', '?kind=project&archived=1')).toEqual([
      { name: 'all', kinds: ['project'] },
      '?kind=project&status=archived',
    ]);
  });

  it('reads the rooms and a meeting', () => {
    expect(parseRoute('/projects/p%201')).toEqual({
      name: 'project',
      id: 'p 1',
    });
    expect(parseRoute('/people/u%201')).toEqual({ name: 'person', id: 'u 1' });
    expect(parseRoute('/meetings/e-1/')).toEqual({
      name: 'meeting',
      id: 'e-1',
    });
    expect(parseRoute('/projects/p/whiteboard')).toEqual({
      name: 'whiteboard',
      project: 'p',
    });
  });

  it('keeps Settings and Help', () => {
    expect(parseRoute('/settings')).toEqual({
      name: 'settings',
      section: 'appearance',
    });
    expect(parseRoute('/settings/rooms')).toEqual({
      name: 'settings',
      section: 'rooms',
    });
    expect(parseRoute('/settings/people')).toEqual({ name: 'people' });
    expect(parseRoute('/settings/orgs/o-1')).toEqual({
      name: 'orgs',
      org: 'o-1',
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
    expect(parseRoute('/people/x/y')).toEqual({ name: 'notFound' });
    expect(parseRoute('/decisionsx')).toEqual({ name: 'notFound' });
  });

  it('round-trips every route through its address', () => {
    const routes: Route[] = [
      { name: 'today' },
      { name: 'unfiled' },
      { name: 'all' },
      { name: 'all', kinds: ['task'] },
      { name: 'all', kinds: ['note'] },
      { name: 'all', kinds: ['meeting'] },
      { name: 'all', kinds: ['project'] },
      { name: 'all', kinds: ['person'] },
      { name: 'all', kinds: ['task', 'note', 'meeting'] },
      { name: 'project', id: 'a/b' },
      { name: 'person', id: 'u 1' },
      { name: 'meeting', id: 'e 1' },
      { name: 'task', id: 't 1' },
      { name: 'whiteboard' },
      { name: 'whiteboard', project: 'p 1' },
      { name: 'people' },
      { name: 'orgs' },
      { name: 'orgs', org: 'o1' },
      { name: 'settings', section: 'spaces' },
      { name: 'settings', section: 'appearance' },
      { name: 'help' },
    ];
    for (const route of routes) {
      const href = routeHref(route);
      expect(href).not.toBeNull();
      const url = new URL(href as string, 'https://datapad.test');
      expect(landRoute(url.pathname, url.search, url.hash)[0]).toEqual(route);
    }
    expect(routePath({ name: 'notFound' })).toBeNull();
  });

  it('puts All’s kind in the query, first, over any other', () => {
    expect(routeHref({ name: 'all', kinds: ['task'] })).toBe('/all?kind=task');
    expect(routeHref({ name: 'all', kinds: ['note'] }, 'note=n1')).toBe(
      '/all?kind=note&note=n1',
    );
    expect(
      routeSearch({ name: 'all', kinds: ['note'] }, '?kind=task&q=x'),
    ).toBe('?kind=note&q=x');
    expect(routeHref({ name: 'project', id: 'p' }, 'milestone=m')).toBe(
      '/projects/p?milestone=m',
    );
    expect(routeHref({ name: 'help', section: 'data' }, 'x=1')).toBe(
      '/help?x=1#data',
    );
  });
});

describe('redirects from every old address (#329)', () => {
  it('sends Focus, the digest and Decisions to Today', () => {
    expect(landsOn('/focus')).toBe('/');
    expect(landsOn('/focus?view=week')).toBe('/?view=week');
    // The digest is Today's week zoom (#332).
    expect(landsOn('/digest')).toBe('/?view=week');
    expect(landsOn('/digest?to=2026-11-09')).toBe('/?view=week');
    expect(landsOn('/decisions')).toBe('/');
    expect(landsOn('/decisions/d-1?decision=d-1')).toBe('/');
  });

  it('sends the Notepad to Unfiled', () => {
    expect(landsOn('/notepad')).toBe('/unfiled');
    expect(landsOn('/notepad/')).toBe('/unfiled');
    expect(landsOn('/notes?view=notepad')).toBe('/unfiled');
    expect(landsOn('/notes/?project=p1&view=notepad')).toBe('/unfiled');
  });

  it('sends each list page to All with its kind, filters as All reads them', () => {
    expect(landsOn('/tasks')).toBe('/all?kind=task');
    expect(landsOn('/tasks?who=mine&group=priority')).toBe(
      '/all?kind=task&person=me',
    );
    expect(landsOn('/tasks?who=p:u1&status=blocked&q=x&sort=title')).toBe(
      '/all?kind=task&q=x&waiting=1&person=u1&sort=title',
    );
    expect(landsOn('/tasks?status=done&who=unassigned')).toBe(
      '/all?kind=task&status=done',
    );
    expect(landsOn('/notes')).toBe('/all?kind=note');
    expect(landsOn('/notes?note=n1')).toBe('/all?kind=note&note=n1');
    expect(landsOn('/notes?project=p1&pinned=1')).toBe(
      '/all?kind=note&room=p1',
    );
    expect(landsOn('/meetings')).toBe('/all?kind=meeting');
    expect(landsOn('/meetings?view=calendar')).toBe('/all?kind=meeting');
    expect(landsOn('/projects')).toBe('/all?kind=project');
    expect(landsOn('/projects/?view=cards&status=paused&org=x')).toBe(
      '/all?kind=project',
    );
    expect(landsOn('/projects?status=all')).toBe(
      '/all?kind=project&status=all',
    );
    expect(landsOn('/archive')).toBe('/all?kind=project&status=archived');
    expect(landsOn('/archive?sort=name')).toBe(
      '/all?kind=project&status=archived&sort=name',
    );
  });

  it('sends Events, an old name for Meetings, there too', () => {
    expect(landsOn('/events')).toBe('/all?kind=meeting');
    expect(landsOn('/events?project=p1&view=calendar')).toBe(
      '/all?kind=meeting&room=p1',
    );
  });

  it('opens the meeting an old link named', () => {
    expect(landsOn('/meetings?view=list&meeting=e-1')).toBe('/meetings/e-1');
    expect(landsOn('/events?event=e-1&view=list')).toBe('/meetings/e-1');
    expect(landsOn('/events/?event=e%201')).toBe('/meetings/e%201');
  });

  it('sends Lists and each list to All’s notes', () => {
    expect(landsOn('/lists')).toBe('/all?kind=note');
    expect(landsOn('/lists?view=table&show=done')).toBe('/all?kind=note');
    expect(landsOn('/lists/l-evac')).toBe('/all?kind=note');
    expect(landsOn('/lists/l-1/items')).toBe('null');
  });

  it('sends a task to its room, with its panel (the shell finishes it)', () => {
    expect(landRoute('/tasks/t%201', '?x=1')).toEqual([
      { name: 'task', id: 't 1' },
      '',
    ]);
    expect(taskRoom({ projectId: 'p-echo' })).toEqual({
      name: 'project',
      id: 'p-echo',
    });
    expect(taskRoom({ projectId: null })).toEqual({ name: 'today' });
  });

  it('sends a person under Settings to their room', () => {
    expect(landsOn('/settings/people/u-han')).toBe('/people/u-han');
    expect(landsOn('/settings/people/u-han?view=cards')).toBe(
      '/people/u-han?view=cards',
    );
    expect(landsOn('/settings/people')).toBe('/settings/people');
    expect(landsOn('/people')).toBe('/settings/people');
  });

  it('keeps the #93 addresses for orgs', () => {
    expect(landsOn('/orgs')).toBe('/settings/orgs');
    expect(landsOn('/orgs/o-1/')).toBe('/settings/orgs/o-1');
  });

  it('sends Settings → Navigation to Settings → Rooms', () => {
    expect(landsOn('/settings/navigation')).toBe('/settings/rooms');
    expect(landsOn('/settings/pages')).toBe('/settings/today');
  });
});

describe('whiteboards', () => {
  it('reads and writes the space board and a project board', () => {
    expect(parseRoute('/whiteboard')).toEqual({ name: 'whiteboard' });
    expect(parseRoute('/whiteboard/')).toEqual({ name: 'whiteboard' });
    expect(routePath({ name: 'whiteboard' })).toBe('/whiteboard');
    expect(routePath({ name: 'whiteboard', project: 'p 1' })).toBe(
      '/projects/p%201/whiteboard',
    );
    expect(parseRoute('/projects/p/whiteboard/x')).toEqual({
      name: 'notFound',
    });
  });

  it('links a whiteboard item: its board, with ?item=', () => {
    expect(boardRoute('general')).toEqual({ name: 'whiteboard' });
    expect(boardRoute('p-echo')).toEqual({
      name: 'whiteboard',
      project: 'p-echo',
    });
    const link = boardItemLink('p-echo', 'b 1');
    expect(routePath(link.route)).toBe('/projects/p-echo/whiteboard');
    expect(new URLSearchParams(link.query).get(BOARD_ITEM_PARAM)).toBe('b 1');
    expect(routePath(boardItemLink('general', 'b2').route)).toBe('/whiteboard');
  });
});

describe('placeOf and titleOf', () => {
  it('puts each route in its place, or none', () => {
    expect(placeOf({ name: 'today' })).toBe('today');
    expect(placeOf({ name: 'unfiled' })).toBe('unfiled');
    expect(placeOf({ name: 'all' })).toBe('all');
    expect(placeOf({ name: 'all', kinds: ['task'] })).toBe('all');
    // The space's board is linked from All; a project's is in its room.
    expect(placeOf({ name: 'whiteboard' })).toBe('all');
    expect(placeOf({ name: 'whiteboard', project: 'p' })).toBeNull();
    expect(placeOf({ name: 'project', id: 'p' })).toBeNull();
    expect(placeOf({ name: 'person', id: 'u' })).toBeNull();
    expect(placeOf({ name: 'settings', section: 'data' })).toBeNull();
  });

  it('titles the pages', () => {
    expect(titleOf({ name: 'today' })).toBe('Today');
    expect(titleOf({ name: 'unfiled' })).toBe('Unfiled');
    expect(titleOf({ name: 'all' })).toBe('All');
    expect(titleOf({ name: 'all', kinds: ['task'] })).toBe('All');
    expect(titleOf({ name: 'project', id: 'p' }, 'Alpha')).toBe('Alpha');
    expect(titleOf({ name: 'project', id: 'p' })).toBe('Project');
    expect(titleOf({ name: 'person', id: 'u' }, 'Han')).toBe('Han');
    expect(titleOf({ name: 'person', id: 'u' })).toBe('Person');
    expect(titleOf({ name: 'meeting', id: 'e' }, 'Standup')).toBe('Standup');
    expect(titleOf({ name: 'meeting', id: 'e' })).toBe('Meeting');
    expect(titleOf({ name: 'task', id: 't' })).toBe('Task');
    expect(titleOf({ name: 'whiteboard' })).toBe('Whiteboard');
    expect(titleOf({ name: 'people' })).toBe('People');
    expect(titleOf({ name: 'orgs' })).toBe('Orgs');
  });
});

describe('Settings sections', () => {
  it('lists the v2 sections, People and Orgs after Spaces (#343)', () => {
    expect(SETTINGS_SECTIONS).toEqual([
      'appearance',
      'today',
      'rooms',
      'capture',
      'all',
      'templates',
      'summaries',
      'spaces',
      'people',
      'orgs',
      'data',
      'connections',
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
    expect(settingsSectionOf({ name: 'all' })).toBeNull();
  });
});

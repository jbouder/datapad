import type { APIRequestContext, Page } from '@playwright/test';
import { addDays } from '../shared/dates';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  expectSaved,
  isMobile,
  moreActions,
  openLive,
  SEED,
  test,
  today,
} from './fixtures';

/**
 * The person room (#335): the header with its state line and actions,
 * their projects to narrow it to, the Next meeting card, the lanes (You
 * owe, They owe you, To discuss) and the stream. In the seed Leia is
 * you; Han Solo (Captain) is on Echo Base relocation (Rebel Alliance)
 * and the Falcon hyperdrive refit (Corellian Engineering). Leia's shield
 * generator mentions him (You owe), the motivator is his (They owe you).
 * The test adds a 1:1 on the Falcon two days out, with an open topic.
 */

test.beforeEach(async ({ request }) => {
  const seed = structuredClone(SEED);
  const at = new Date().toISOString();
  (seed.meetings as Record<string, unknown>)['e-9'] = {
    id: 'e-9',
    projectId: 'p-falcon',
    title: 'Falcon 1:1',
    date: addDays(today(), 2),
    time: '10:00',
    end: '10:30',
    attendees: ['u-leia', 'u-han'],
    link: '',
    note: '',
    topics: [
      { id: 'tp-9a', title: 'Motivator budget', done: false, outcome: '' },
      { id: 'tp-9b', title: 'Old business', done: true, outcome: 'Done' },
    ],
    createdAt: at,
    updatedAt: at,
  };
  await request.post('/api/import', { data: seed });
});

const room = (page: Page) =>
  page.locator('article[aria-labelledby="person-title"]');
const lanes = (page: Page) =>
  page.getByRole('complementary', { name: 'Open loops' });
const stream = (page: Page) => page.getByRole('list', { name: 'Stream' });
const comingUp = (page: Page) => page.getByRole('list', { name: 'Coming up' });
const projects = (page: Page) =>
  page.getByRole('navigation', { name: 'Narrow to a project' });

/** Each entry's key, in order: Coming up's, then the stream's. */
async function keys(page: Page): Promise<string[]> {
  const out: string[] = [];
  for (const list of [comingUp(page), stream(page)]) {
    if ((await list.count()) === 0) continue;
    out.push(
      ...(await list
        .locator(':scope > li')
        .evaluateAll((rows) =>
          rows.map(
            (r) =>
              r.getAttribute('data-stream') ??
              `note:${r.getAttribute('data-note-id')}`,
          ),
        )),
    );
  }
  return out;
}

/** Each lane's task titles, by lane. */
async function laneTitles(page: Page) {
  const titles = async (name: string) => {
    const section = lanes(page).getByRole('list', { name });
    if ((await section.count()) === 0) return [];
    return section.locator('[data-task-title]').allInnerTexts();
  };
  return {
    mine: await titles('You owe'),
    waiting: await lanes(page)
      .locator('[data-waiting] [data-task-title]')
      .allInnerTexts(),
    decide: await titles('To discuss'),
  };
}

async function stored(request: APIRequestContext) {
  return (await request.get('/api/export.json')).json();
}

test('the room: header, state line, projects, lanes, Next meeting, stream', async ({
  page,
}) => {
  await openLive(page, '/people/u-han');
  await expect(page).toHaveTitle('Han Solo · Datapad');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Han Solo');
  // The orgs of his projects.
  await expect(room(page)).toContainText(
    'Corellian Engineering · Rebel Alliance',
  );
  await expect(page.locator('[data-state-line]')).toHaveText(
    'Captain · 2 projects · 2 open',
  );
  await expect(projects(page).getByRole('link')).toHaveText([
    'Echo Base relocation',
    'Falcon hyperdrive refit',
  ]);
  await expect(
    page.getByRole('region', { name: 'Next meeting' }),
  ).toBeVisible();

  // The lanes.
  await expect(lanes(page).getByRole('list', { name: 'You owe' })).toHaveText(
    /Confirm shield generator delivery/,
  );
  await expect(
    lanes(page).getByRole('list', { name: 'Waiting on Han Solo' }),
  ).toContainText('Find a replacement motivator');
  // To discuss: the open topic of the 1:1 ahead, not the covered one.
  const topics = lanes(page).getByRole('list', { name: 'Open topics' });
  await expect(topics.getByRole('link')).toHaveText(['Motivator budget']);
  await expect(
    topics.getByRole('link', { name: 'Motivator budget' }),
  ).toHaveAttribute('href', '/meetings/e-9');

  // The stream: his tasks and the meetings he attends; nothing else.
  const all = await keys(page);
  expect(all.sort()).toEqual(
    [
      'added:t-1',
      'added:t-5',
      'meeting:e-1',
      'meeting:e-3',
      'meeting:e-9',
    ].sort(),
  );

  expect(await moreActions(page)).toEqual(['Remove']);
  await expect(
    page.getByRole('button', { name: 'Edit', exact: true }),
  ).toBeVisible();

  await expectNoSidewaysScroll(page);
  await expectAccessible(page);
});

test('narrow to a project: the same items as the project room narrowed to him', async ({
  page,
}) => {
  for (const [project, name] of [
    ['p-echo', 'Echo Base relocation'],
    ['p-falcon', 'Falcon hyperdrive refit'],
  ] as const) {
    await openLive(page, '/people/u-han');
    await projects(page).getByRole('link', { name }).click();
    await expect(page).toHaveURL(
      new RegExp(`/people/u-han\\?project=${project}$`),
    );
    await expect(projects(page).getByRole('link', { name })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(page.locator('[data-state-line]')).toContainText(
      `Narrowed to ${name}`,
    );
    // The address round-trips.
    await page.reload();
    await expect(projects(page).getByRole('link', { name })).toHaveAttribute(
      'aria-current',
      'true',
    );
    const personKeys = (await keys(page)).sort();
    const personLanes = await laneTitles(page);

    await openLive(page, `/projects/${project}?person=u-han`);
    await expect(page.locator('[data-state-line]')).toContainText(
      'Narrowed to Han Solo',
    );
    expect((await keys(page)).sort()).toEqual(personKeys);
    const projectLanes = {
      mine: await lanes(page)
        .getByRole('list', { name: 'Mine' })
        .locator('[data-task-title]')
        .allInnerTexts()
        .catch(() => []),
      waiting: await lanes(page)
        .locator('[data-waiting] [data-task-title]')
        .allInnerTexts(),
      decide: await lanes(page)
        .getByRole('list', { name: 'To decide' })
        .locator('[data-task-title]')
        .allInnerTexts()
        .catch(() => []),
    };
    expect(projectLanes).toEqual(personLanes);
  }

  // Narrowed to the Falcon: the motivator, and the 1:1's topic.
  await openLive(page, '/people/u-han?project=p-falcon');
  await expect(
    lanes(page).getByRole('list', { name: 'Waiting on Han Solo' }),
  ).toContainText('Find a replacement motivator');
  await expect(
    lanes(page).getByRole('list', { name: 'Open topics' }),
  ).toContainText('Motivator budget');
  await expect(lanes(page)).not.toContainText('Confirm shield generator');

  // Clear shows everything again.
  await page.getByRole('link', { name: 'Clear' }).click();
  await expect(page).toHaveURL(/\/people\/u-han$/);
  await expect(lanes(page)).toContainText('Confirm shield generator');
});

test('capture mentions or assigns him, and narrowed files to the project', async ({
  page,
  request,
}) => {
  await openLive(page, '/people/u-han');
  const capture = page.getByRole('combobox', { name: /capture/i });
  await capture.fill('Owes me a sabacc rematch');
  await capture.press('Enter');
  await expect(stream(page).locator(':scope > li').first()).toContainText(
    'Owes me a sabacc rematch',
  );
  await capture.fill('todo Return the hydrospanner');
  await capture.press('Enter');
  await expect(
    lanes(page).getByRole('list', { name: 'Waiting on Han Solo' }),
  ).toContainText('Return the hydrospanner');

  // Narrowed to Echo Base: both file there too.
  await projects(page)
    .getByRole('link', { name: 'Echo Base relocation' })
    .click();
  await expect(page).toHaveURL(/\?project=p-echo$/);
  await capture.fill('Check the tauntaun saddles');
  await capture.press('Enter');
  await expect(stream(page).locator(':scope > li').first()).toContainText(
    'Check the tauntaun saddles',
  );
  await expectSaved(page);

  const data = await stored(request);
  const notes = Object.values(data.notes) as {
    body: string;
    projectId: string | null;
  }[];
  expect(notes.find((n) => n.body.includes('sabacc'))).toMatchObject({
    body: 'Owes me a sabacc rematch @{u-han}',
    projectId: null,
  });
  expect(notes.find((n) => n.body.includes('saddles'))).toMatchObject({
    body: 'Check the tauntaun saddles @{u-han}',
    projectId: 'p-echo',
  });
  const tasks = Object.values(data.tasks) as {
    title: string;
    assignee: string;
  }[];
  expect(
    tasks.find((t) => t.title === 'Return the hydrospanner')?.assignee,
  ).toBe('u-han');
});

test('pin him, and pin him on one project as the project room’s pair', async ({
  page,
}) => {
  await openLive(page, '/people/u-han');
  const pin = page.getByRole('button', { name: 'Pin' });
  await pin.click();
  await expect(pin).toHaveAttribute('aria-pressed', 'true');

  await projects(page)
    .getByRole('link', { name: 'Falcon hyperdrive refit' })
    .click();
  await expect(pin).toHaveAttribute('aria-pressed', 'false');
  await pin.click();
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
  if (!isMobile(page)) {
    await expect(
      page
        .getByRole('complementary', { name: 'Datapad' })
        .getByRole('link', { name: 'Falcon hyperdrive refit · Han Solo' }),
    ).toHaveAttribute('aria-current', 'page');
  }
  // The same pin from the project room's side.
  await openLive(page, '/projects/p-falcon?person=u-han');
  await expect(page.getByRole('button', { name: 'Pin' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('Edit, Schedule meeting, and Remove', async ({ page, request }) => {
  await openLive(page, '/people/u-han');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Edit Han Solo' });
  await form.getByRole('textbox', { name: 'Role' }).fill('General');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toBeHidden();
  await expect(page.locator('[data-state-line]')).toContainText('General');

  await page.getByRole('button', { name: 'Schedule meeting' }).click();
  const meeting = page.getByRole('dialog', { name: 'New meeting' });
  await expect(meeting).toContainText('Han Solo');
  await page.keyboard.press('Escape');
  await expect(meeting).toBeHidden();

  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  const ask = page.getByRole('dialog', { name: 'Remove person' });
  await expect(ask).toContainText(
    'Remove Han Solo? Mentions of them show as @unknown and 1 task becomes unassigned.',
  );
  await ask.getByRole('button', { name: 'Remove' }).click();
  await expect(page).toHaveURL(/\/settings\/people$/);
  await expectSaved(page);
  const data = await stored(request);
  expect(data.people['u-han']).toBeUndefined();
  expect(data.tasks['t-5'].assignee).toBe('');
});

test('the lanes take their names and order from Settings → Rooms (#343)', async ({
  page,
}) => {
  await openLive(page, '/settings/rooms');
  const name = page.getByRole('textbox', { name: 'You owe' });
  await name.fill('On me');
  await name.press('Enter');
  const editor = page.getByRole('list', { name: 'Person room lanes' });
  // The editor names the lane as the room will.
  await expect(
    editor.getByRole('switch', { name: 'Show On me' }),
  ).toBeVisible();
  await editor.getByRole('switch', { name: 'Show To discuss' }).click();
  await expectAccessible(page);
  await expectSaved(page);

  await openLive(page, '/people/u-han');
  await expect(lanes(page).getByRole('list', { name: 'On me' })).toHaveText(
    /Confirm shield generator delivery/,
  );
  await expect(
    lanes(page).getByRole('button', { name: /^To discuss/ }),
  ).toHaveCount(0);
});

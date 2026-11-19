import type { APIRequestContext, Page } from '@playwright/test';
import { addDays, formatDay, longDay } from '../shared/dates';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  expectNote,
  expectSaved,
  fillNote,
  isMobile,
  moreAction,
  moreActions,
  openLive,
  SEED,
  test,
  today,
} from './fixtures';

interface Stored {
  meetings: Record<string, { title: string; topics?: { title: string }[] }>;
  notes: Record<string, { body: string; meetingId: string | null }>;
  tasks: Record<string, { title: string; meetingId?: string | null }>;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

const nextWeek = () => addDays(today(), 7);

type Seed = typeof SEED & { meetings: Record<string, unknown> };

/**
 * Shield review today with three topics (one covered), and the same
 * meeting again next week (the same series), without any. Leia is you,
 * so Shield review (Leia and Han) is a 1:1 with Han. `change` adjusts
 * the data before it goes in.
 */
async function seed(
  request: APIRequestContext,
  change: (data: Seed) => void = () => undefined,
) {
  const data = structuredClone(SEED) as Seed;
  const shield = data.meetings['e-1'] as (typeof SEED.meetings)['e-1'] & {
    topics?: unknown;
  };
  shield.date = today();
  shield.topics = [
    { id: 't-power', title: 'Power budget', done: true, outcome: 'Approved' },
    { id: 't-ridge', title: 'North ridge', done: false, outcome: '' },
    { id: 't-probe', title: 'Probe droid sightings', done: false, outcome: '' },
  ];
  data.meetings['e-5'] = { ...shield, id: 'e-5', date: nextWeek(), topics: [] };
  change(data);
  await request.post('/api/import', { data });
}

/** The nav (rail or tab bar), which meeting mode keeps. */
function nav(page: Page) {
  return isMobile(page)
    ? page.getByRole('navigation', { name: 'Sections' })
    : page.getByRole('complementary', { name: 'Datapad' });
}

function topics(page: Page) {
  return page
    .getByRole('list', { name: 'Topics for “Shield review”' })
    .locator('[data-topic-title]');
}

test('meeting mode: the header, agenda, notes and the 1:1’s loops', async ({
  page,
  request,
}) => {
  await seed(request);
  await openLive(page, '/all?kind=meeting');
  await page
    .locator('[data-meeting-id="e-1"]')
    .getByRole('link', { name: 'Shield review', exact: true })
    .click();
  await expect(page).toHaveURL(/\/meetings\/e-1$/);
  await expect(page).toHaveTitle('Shield review · Datapad');
  const main = page.getByRole('main');
  await expect(
    main.getByRole('heading', { level: 1, name: 'Shield review' }),
  ).toBeVisible();
  // In the app's frame like any page: the rail or tab bar, and Search.
  await expect(nav(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search' })).toBeVisible();

  const details = main.getByRole('list', { name: 'Details' });
  await expect(details).toContainText(
    `${longDay(today(), today())} · 2:00–3:00 PM`,
  );
  await expect(
    details.getByRole('link', { name: 'Echo Base relocation' }),
  ).toHaveAttribute('href', '/projects/p-echo');
  await expect(details.getByRole('link', { name: 'Han Solo' })).toHaveAttribute(
    'href',
    '/people/u-han',
  );
  await expect(
    details.getByRole('link', { name: 'Leia Organa' }),
  ).toHaveAttribute('href', '/people/u-leia');
  await expect(main.getByRole('link', { name: /^Join/ })).toHaveAttribute(
    'href',
    'https://example.com/meet/shield',
  );
  await expect(main).toContainText('Power budget and the north ridge.');
  await expect(topics(page)).toHaveText([
    'Power budget',
    'North ridge',
    'Probe droid sightings',
  ]);
  await expect(
    main.getByRole('region', { name: 'Notes', exact: true }),
  ).toContainText('Bring the power budget');
  await expect(
    main.getByRole('region', { name: 'Action items' }),
  ).toBeVisible();

  // Leia is you, so this is a 1:1 with Han: his loops.
  const loops = main.getByRole('complementary', {
    name: 'Open loops with Han Solo',
  });
  await expect(loops).toContainText('Find a replacement motivator');
  await expect(loops).not.toContainText('Insulate the hangar doors');

  await expectNoSidewaysScroll(page);
  await expectAccessible(page);

  // Esc leaves, back to where it came from.
  await main.getByRole('heading', { level: 1 }).click();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/all\?kind=meeting$/);
  await expect(nav(page)).toBeVisible();
});

test('the project’s loops, the phase, and no loops with neither', async ({
  page,
  request,
}) => {
  await seed(request, (data) => {
    // Three in the room, this week and next: the project's loops instead.
    for (const id of ['e-1', 'e-5']) {
      (data.meetings[id] as { attendees: string[] }).attendees = [
        'u-leia',
        'u-han',
        'u-chewie',
      ];
    }
  });
  await openLive(page, '/meetings/e-1');
  const loops = page.getByRole('complementary', {
    name: 'Open loops with Echo Base relocation',
  });
  await expect(loops).toContainText('Insulate the hangar doors');
  await expect(loops).toContainText('Confirm shield generator delivery');
  await expect(loops).not.toContainText('Find a replacement motivator');

  // Next week's is still to come.
  await page
    .getByRole('navigation', { name: 'This series' })
    .getByRole('link', { name: /^Next/ })
    .click();
  await expect(page).toHaveURL(/\/meetings\/e-5$/);
  await expect(page.locator('article[data-phase]')).toHaveAttribute(
    'data-phase',
    'prep',
  );
  await expect(page.getByText('Prep', { exact: true })).toBeVisible();

  // No project and nobody else: nothing to show.
  await openLive(page, '/meetings/e-4');
  await expect(
    page.getByRole('complementary', { name: 'Open loops' }),
  ).toContainText('no open loops to show');
});

test('add a topic, a note and an action item', async ({ page, request }) => {
  await seed(request);
  await openLive(page, '/meetings/e-1');
  const main = page.getByRole('main');

  await main.getByRole('button', { name: 'Add topic' }).click();
  const topic = main.getByRole('textbox', { name: /^Add a topic/ });
  await topic.fill('Snowspeeder repairs');
  await topic.press('Enter');
  await expect(topics(page)).toHaveText([
    'Power budget',
    'North ridge',
    'Probe droid sightings',
    'Snowspeeder repairs',
  ]);
  await topic.press('Escape');
  // Esc in a field closes it; it does not leave.
  await expect(page).toHaveURL(/\/meetings\/e-1$/);

  // The composer is always open.
  const notes = main.getByRole('region', { name: 'Notes', exact: true });
  const composer = notes.getByRole('textbox', {
    name: 'New note for “Shield review”',
  });
  await fillNote(composer, 'The ridge needs two more sensors.');
  await notes.getByRole('button', { name: 'Save note' }).click();
  await expectNote(composer, '');
  await expect(notes.getByRole('list')).toContainText(
    'The ridge needs two more sensors.',
  );
  // Save note hands focus back to the composer once it settles.
  await expect(composer).toBeFocused();

  // A double-click on a saved note's text opens it for editing.
  const saved = notes.getByRole('listitem').filter({
    hasText: 'The ridge needs two more sensors.',
  });
  await saved.getByText('The ridge needs two more sensors.').dblclick();
  const editor = saved.getByRole('textbox', { name: 'Edit note' });
  await expect(editor).toBeVisible();
  await saved.getByRole('button', { name: 'Cancel' }).click();
  await expect(editor).toHaveCount(0);

  // A line becomes an action item from the composer.
  // The composer can still be settling after Save note: type again
  // until the / menu opens.
  await expect(async () => {
    await fillNote(composer, 'Order the sensors ');
    await composer.pressSequentially('/task');
    await expect(page.getByRole('option', { name: /^Task/ })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass();
  await composer.press('Enter');
  await expectNote(composer, '- [ ] Order the sensors');
  await expect(
    page.getByText('Added an action item to Shield review'),
  ).toBeVisible();
  await notes.getByRole('button', { name: 'Save note' }).click();
  await expectNote(composer, '');

  const items = main.getByRole('region', { name: 'Action items' });
  await items.getByRole('button', { name: 'Add an action item' }).click();
  const add = items.getByRole('textbox', { name: /^Add an action item/ });
  await add.fill('Brief the patrol');
  await add.press('Enter');
  await expect(items.getByRole('list')).toContainText('Brief the patrol');
  await add.press('Escape');

  await expectNoSidewaysScroll(page);
  await expectAccessible(page);

  await expectSaved(page);
  const data = await stored(request);
  expect(data.meetings['e-1']?.topics?.map((t) => t.title)).toContain(
    'Snowspeeder repairs',
  );
  expect(
    Object.values(data.notes).some(
      (n) =>
        n.meetingId === 'e-1' && n.body === 'The ridge needs two more sensors.',
    ),
  ).toBe(true);
  const actions = Object.values(data.tasks)
    .filter((t) => t.meetingId === 'e-1')
    .map((t) => t.title);
  expect(actions).toContain('Brief the patrol');
  expect(actions).toContain('Order the sensors');
});

test('carry forward both ways, and Previous and Next', async ({
  page,
  request,
}) => {
  await seed(request);
  await openLive(page, '/meetings/e-5');
  const series = page.getByRole('navigation', { name: 'This series' });
  await expect(series.getByRole('link', { name: /^Next/ })).toHaveCount(0);

  // From the last meeting of the series, on the agenda.
  await page
    .getByRole('button', {
      name: `Carry forward 2 topics from ${formatDay(today(), today())}`,
    })
    .click();
  await expect(
    page.getByText(`Carried 2 topics from ${formatDay(today(), today())}`),
  ).toBeVisible();
  await expect(topics(page)).toHaveText([
    'North ridge',
    'Probe droid sightings',
  ]);
  await expect(
    page.getByRole('button', { name: /^Carry forward/ }),
  ).toHaveCount(0);

  await series
    .getByRole('link', { name: `Previous: ${formatDay(today(), today())}` })
    .click();
  await expect(page).toHaveURL(/\/meetings\/e-1$/);
  await expect(
    page.getByRole('main').locator('[data-topic-outcome]'),
  ).toHaveText(['Approved', 'Carried forward', 'Carried forward']);
  // Nothing left to carry to the next one either.
  expect(await moreActions(page)).not.toContain('Carry forward');
  // The menu took that Esc: still here.
  await expect(page).toHaveURL(/\/meetings\/e-1$/);

  await expectSaved(page);
  expect(
    (await stored(request)).meetings['e-5']?.topics?.map((t) => t.title),
  ).toEqual(['North ridge', 'Probe droid sightings']);
});

test('Carry forward to the next meeting from More', async ({
  page,
  request,
}) => {
  await seed(request);
  await openLive(page, '/meetings/e-1');
  await moreAction(page, 'Carry forward');
  await expect(
    page.getByText(`Carried 2 topics to ${formatDay(nextWeek(), today())}`),
  ).toBeVisible();
  await expect(
    page.getByRole('main').locator('[data-topic-outcome]'),
  ).toHaveText(['Approved', 'Carried forward', 'Carried forward']);
});

test('Leave goes back to where you came from, through the series', async ({
  page,
  request,
}) => {
  await seed(request);
  await openLive(page, '/projects/p-echo');
  await page.goto('/meetings/e-1');
  // A fresh load has nowhere to go back to: Today.
  await page.getByRole('button', { name: /^Leave/ }).click();
  await expect(page).toHaveURL(/\/$/);

  await openLive(page, '/all?kind=meeting');
  await page
    .locator('[data-meeting-id="e-1"]')
    .getByRole('link', { name: 'Shield review', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'This series' })
    .getByRole('link', { name: /^Next/ })
    .click();
  await expect(page).toHaveURL(/\/meetings\/e-5$/);
  await page.getByRole('button', { name: /^Leave/ }).click();
  await expect(page).toHaveURL(/\/all\?kind=meeting$/);
});

test('Edit opens the form; Delete asks, keeps the notes, then leaves', async ({
  page,
  request,
}) => {
  await seed(request);
  await openLive(page, '/meetings/e-1');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Edit Shield review' });
  await form.getByLabel('Title').fill('Shield and ridge review');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toBeHidden();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Shield and ridge review' }),
  ).toBeVisible();
  await expect(page).toHaveTitle('Shield and ridge review · Datapad');

  await moreAction(page, 'Delete');
  const ask = page.getByRole('alertdialog');
  await expect(ask).toContainText('Its note is kept.');
  await expect(ask.getByRole('button', { name: 'Keep it' })).toBeFocused();
  await ask.getByRole('button', { name: 'Delete meeting' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByText('Deleted “Shield and ridge review”'),
  ).toBeVisible();

  await expectSaved(page);
  const data = await stored(request);
  expect(data.meetings['e-1']).toBeUndefined();
  expect(data.notes['n-2']).toBeDefined();
});

test('a meeting that is not there says so', async ({ page }) => {
  await openLive(page, '/');
  await page.goto('/meetings/nope');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Not found' }),
  ).toBeVisible();
  await expect(page.getByText('There is no meeting here.')).toBeVisible();
  await page.getByRole('link', { name: 'Go to Today' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('search opens meeting mode', async ({ page, request }) => {
  await seed(request);
  await openLive(page, '/');
  await page.getByRole('button', { name: 'Search' }).click();
  const search = page.getByRole('dialog', { name: 'Search' });
  await expect(search.getByRole('combobox')).toBeFocused();
  await search.getByRole('combobox').fill('Medal');
  await page
    .getByRole('group', { name: 'Meetings' })
    .getByRole('option', { name: /Medal ceremony/ })
    .click();
  await expect(page).toHaveURL(/\/meetings\/e-3$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Medal ceremony' }),
  ).toBeVisible();
});

test('the / menu in the notes sits above the note cards', async ({
  page,
  request,
}) => {
  await seed(request);
  await openLive(page, '/meetings/e-1');
  const notes = page
    .getByRole('main')
    .getByRole('region', { name: 'Notes', exact: true });
  await notes.getByRole('textbox').first().click();
  await page.keyboard.type('/');
  const menu = page.getByRole('listbox', { name: 'Commands' });
  await expect(menu).toBeVisible();
  // Its lowest option on screen is over the note card below the
  // composer, and must be what a click there reaches.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const list = document.querySelector(
          '[role=listbox][aria-label=Commands]',
        );
        if (!list) return false;
        const r = list.getBoundingClientRect();
        const y = Math.min(r.bottom, window.innerHeight) - 20;
        return list.contains(document.elementFromPoint(r.left + 20, y));
      }),
    )
    .toBe(true);
});

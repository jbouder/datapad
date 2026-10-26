import type { APIRequestContext, Page } from '@playwright/test';
import { addDays, formatDay, localDate } from '../shared/dates';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  expectSaved,
  isMobile,
  openLive,
  SEED,
  test,
} from './fixtures';

interface StoredTopic {
  id: string;
  title: string;
  done: boolean;
  outcome: string;
}

interface Stored {
  meetings: Record<
    string,
    { id: string; title: string; topics?: StoredTopic[] }
  >;
  activity: Record<string, { events: { text: string }[] }>;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

const today = localDate(new Date());
const shieldDay = addDays(today, 3);

const TOPICS = [
  { id: 't-power', title: 'Power budget', done: true, outcome: 'Approved' },
  { id: 't-ridge', title: 'North ridge', done: false, outcome: '' },
  { id: 't-probe', title: 'Probe droid sightings', done: false, outcome: '' },
];

test.beforeEach(async ({ request }) => {
  // The seed's dates are fixed: Shield review a few days ahead, with
  // three topics (one covered, with an outcome).
  const seed = structuredClone(SEED);
  seed.meetings['e-1'].date = shieldDay;
  (seed.meetings['e-1'] as { topics?: unknown }).topics = TOPICS;
  await request.post('/api/import', { data: seed });
});

function row(page: Page, title: string) {
  return page.locator('[data-meeting-id]').filter({ hasText: title }).first();
}

function topicList(page: Page, meeting = 'Shield review') {
  return row(page, meeting).getByRole('list', {
    name: `Topics for “${meeting}”`,
  });
}

function titles(page: Page) {
  return topicList(page).locator('[data-topic-title]');
}

async function topicAction(page: Page, topic: string, name: string) {
  await topicList(page)
    .getByRole('button', { name: `More for topic “${topic}”` })
    .click();
  await page.getByRole('menuitem', { name }).click();
}

test('shows topics and their count on the meeting row', async ({ page }) => {
  await openLive(page, '/meetings');
  const shield = row(page, 'Shield review');
  await expect(shield.locator('[data-topic-count]')).toHaveText(
    '1 of 3 topics',
  );
  await expect(titles(page)).toHaveText([
    'Power budget',
    'North ridge',
    'Probe droid sightings',
  ]);
  await expect(
    topicList(page).getByRole('checkbox', { name: 'Covered: “Power budget”' }),
  ).toBeChecked();
  await expect(topicList(page)).toContainText('Approved');
  await expectNoSidewaysScroll(page);
  await expectAccessible(page);

  // Focus's agenda counts them too.
  await page.goto('/');
  await expect(
    page
      .getByRole('region', { name: 'Next 7 days' })
      .locator('[data-agenda-id="e-1"]'),
  ).toContainText('1 of 3 topics');
});

test('adds topics from the form, in one batch with the meeting', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-echo');
  await page.getByRole('button', { name: 'Add meeting' }).click();
  const form = page.getByRole('dialog', { name: 'New meeting' });
  await form.getByLabel('Title').fill('Hangar walkthrough');
  await form.getByLabel('Date').fill('+2d');
  await form.getByLabel('Date').press('Tab');
  await form
    .getByLabel('Topics')
    .fill('Door insulation\n\n  Tauntaun stalls  \nSnowspeeder bays');
  await form.getByRole('button', { name: 'Add meeting' }).click();
  await expect(form).toBeHidden();

  const added = row(page, 'Hangar walkthrough');
  await expect(added.locator('[data-topic-count]')).toHaveText('0 of 3 topics');
  await expect(
    topicList(page, 'Hangar walkthrough').locator('[data-topic-title]'),
  ).toHaveText(['Door insulation', 'Tauntaun stalls', 'Snowspeeder bays']);

  await expectSaved(page);
  const data = await stored(request);
  const meeting = Object.values(data.meetings).find(
    (m) => m.title === 'Hangar walkthrough',
  );
  expect(meeting?.topics?.map((t) => t.title)).toEqual([
    'Door insulation',
    'Tauntaun stalls',
    'Snowspeeder bays',
  ]);
  expect(
    data.activity['p-echo']?.events.slice(0, 4).map((e) => e.text),
  ).toEqual([
    'Added topic "Snowspeeder bays" to "Hangar walkthrough"',
    'Added topic "Tauntaun stalls" to "Hangar walkthrough"',
    'Added topic "Door insulation" to "Hangar walkthrough"',
    'Added meeting "Hangar walkthrough"',
  ]);

  // Editing adds more after the ones it has.
  await added
    .getByRole('button', { name: 'Hangar walkthrough', exact: true })
    .click();
  const edit = page.getByRole('dialog', { name: 'Edit Hangar walkthrough' });
  await expect(edit.getByLabel('Topics')).toHaveValue('');
  await edit.getByLabel('Topics').fill('Wampa sightings');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit).toBeHidden();
  await expect(added.locator('[data-topic-count]')).toHaveText('0 of 4 topics');
});

test('inline: add, toggle, record an outcome, rename', async ({
  page,
  request,
}) => {
  await openLive(page, '/meetings');
  const shield = row(page, 'Shield review');
  const add = shield.getByRole('textbox', {
    name: 'Add a topic to “Shield review”',
  });
  await add.fill('Hoth weather');
  await add.press('Enter');
  await expect(add).toHaveValue('');
  await expect(add).toBeFocused();
  await expect(titles(page)).toHaveCount(4);
  await expect(titles(page).last()).toHaveText('Hoth weather');
  // Escape clears without adding.
  await add.fill('Never mind');
  await add.press('Escape');
  await expect(add).toHaveValue('');
  await expect(titles(page)).toHaveCount(4);

  const check = page.getByRole('checkbox', { name: 'Covered: “North ridge”' });
  await topicList(page).locator('label', { has: check }).click();
  await expect(topicList(page).locator(check)).toBeChecked();
  await expect(shield.locator('[data-topic-count]')).toHaveText(
    '2 of 4 topics',
  );

  await topicList(page)
    .getByRole('button', { name: 'Outcome for “North ridge”' })
    .click();
  const outcome = topicList(page).getByRole('textbox', {
    name: 'Outcome of “North ridge”',
  });
  await expect(outcome).toBeFocused();
  await outcome.fill('Shield covers it');
  await outcome.press('Enter');
  await expect(topicList(page)).toContainText('Shield covers it');
  const outcomeButton = topicList(page).getByRole('button', {
    name: 'Outcome for “North ridge”',
  });
  await expect(outcomeButton).toBeFocused();
  // Escape leaves the outcome as it was.
  await outcomeButton.click();
  await outcome.fill('Something else');
  await outcome.press('Escape');
  await expect(outcome).toHaveCount(0);
  await expect(topicList(page)).toContainText('Shield covers it');
  await expect(topicList(page)).not.toContainText('Something else');

  await topicList(page)
    .getByRole('button', { name: 'Probe droid sightings, edit' })
    .click();
  const title = topicList(page).getByRole('textbox', {
    name: 'Title of “Probe droid sightings”',
  });
  await title.fill('Imperial probe droids');
  await title.press('Enter');
  await expect(titles(page).nth(2)).toHaveText('Imperial probe droids');
  await expect(titles(page).nth(2)).toBeFocused();

  await expectSaved(page);
  const topics = (await stored(request)).meetings['e-1']?.topics;
  expect(topics).toEqual([
    TOPICS[0],
    {
      id: 't-ridge',
      title: 'North ridge',
      done: true,
      outcome: 'Shield covers it',
    },
    { ...TOPICS[2], title: 'Imperial probe droids' },
    expect.objectContaining({ title: 'Hoth weather', done: false }),
  ]);
});

test('a meeting without topics gets them from its menu', async ({ page }) => {
  await openLive(page, '/meetings');
  await page.getByRole('button', { name: 'Past' }).click();
  const medal = row(page, 'Medal ceremony');
  await expect(medal.locator('[data-topic-count]')).toHaveCount(0);
  await medal
    .getByRole('button', { name: 'More for “Medal ceremony”' })
    .click();
  await page.getByRole('menuitem', { name: 'Add topic' }).click();
  const add = medal.getByRole('textbox', {
    name: 'Add a topic to “Medal ceremony”',
  });
  await expect(add).toBeFocused();
  await add.fill('Who gets a medal');
  await add.press('Enter');
  await expect(medal.locator('[data-topic-count]')).toHaveText('0 of 1 topic');
});

test('reorder by keyboard: the menu, and Alt+arrows', async ({
  page,
  request,
}) => {
  await openLive(page, '/meetings');
  const more = topicList(page).getByRole('button', {
    name: 'More for topic “Power budget”',
  });
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Move up' })).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Move down' }).focus();
  await page.keyboard.press('Enter');
  await expect(titles(page)).toHaveText([
    'North ridge',
    'Power budget',
    'Probe droid sightings',
  ]);
  await expect(
    page.getByRole('status').filter({ hasText: 'Moved' }),
  ).toHaveText('Moved “Power budget” to position 2 of 3');

  await titles(page).nth(2).focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(titles(page)).toHaveText([
    'North ridge',
    'Probe droid sightings',
    'Power budget',
  ]);

  await expectSaved(page);
  await page.reload();
  await expect(titles(page)).toHaveText([
    'North ridge',
    'Probe droid sightings',
    'Power budget',
  ]);
  expect(
    (await stored(request)).meetings['e-1']?.topics?.map((t) => t.id),
  ).toEqual(['t-ridge', 't-probe', 't-power']);
});

test('reorder by dragging the handle', async ({ page }) => {
  test.skip(isMobile(page), 'Drag is the desktop path.');
  await openLive(page, '/meetings');
  const items = topicList(page).locator('li');
  const handle = items.nth(2).locator('[title="Drag to reorder"]');
  await handle.hover();
  await page.mouse.down();
  await handle.dragTo(items.nth(0));
  await page.mouse.up();
  await expect(titles(page)).toHaveText([
    'Probe droid sightings',
    'Power budget',
    'North ridge',
  ]);
});

test('delete, then Undo puts it back as it was', async ({ page, request }) => {
  await openLive(page, '/meetings');
  await topicAction(page, 'Power budget', 'Delete');
  await expect(titles(page)).toHaveText([
    'North ridge',
    'Probe droid sightings',
  ]);
  await expect(
    row(page, 'Shield review').locator('[data-topic-count]'),
  ).toHaveText('0 of 2 topics');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(titles(page)).toHaveText([
    'Power budget',
    'North ridge',
    'Probe droid sightings',
  ]);
  await expectSaved(page);
  expect((await stored(request)).meetings['e-1']?.topics).toEqual(TOPICS);
});

test('Make a task and Record a decision start from the topic', async ({
  page,
  request,
}) => {
  await openLive(page, '/meetings');
  await topicAction(page, 'North ridge', 'Make a task');
  const task = page.getByRole('dialog', { name: 'New task' });
  await expect(task.getByLabel('Title')).toHaveValue('North ridge');
  await expect(task.getByRole('combobox', { name: 'Project' })).toHaveValue(
    'Echo Base relocation',
  );
  await task.getByRole('button', { name: 'Add task' }).click();
  await expect(task).toBeHidden();

  await topicAction(page, 'Power budget', 'Record a decision');
  const decision = page.getByRole('dialog', { name: 'Decision' });
  await expect(decision.getByLabel('Decision')).toHaveValue('Power budget');
  await expect(decision.getByRole('combobox', { name: 'Project' })).toHaveValue(
    'Echo Base relocation',
  );
  const by = decision.getByRole('group', { name: 'Decided by' });
  await expect(by.getByRole('checkbox', { name: 'Leia Organa' })).toBeChecked();
  await expect(by.getByRole('checkbox', { name: 'Han Solo' })).toBeChecked();
  await expect(
    by.getByRole('checkbox', { name: 'Chewbacca' }),
  ).not.toBeChecked();
  await decision.getByRole('button', { name: 'Add decision' }).click();
  await expect(decision).toBeHidden();

  await expectSaved(page);
  const data = (await (await request.get('/api/export.json')).json()) as {
    tasks: Record<string, { title: string; projectId: string | null }>;
    decisions: Record<
      string,
      { title: string; projectId: string | null; deciders: string[] }
    >;
    meetings: Stored['meetings'];
  };
  expect(Object.values(data.tasks)).toContainEqual(
    expect.objectContaining({ title: 'North ridge', projectId: 'p-echo' }),
  );
  expect(Object.values(data.decisions)).toContainEqual(
    expect.objectContaining({
      title: 'Power budget',
      projectId: 'p-echo',
      deciders: ['u-leia', 'u-han'],
    }),
  );
  // Neither writes back to the topic.
  expect(data.meetings['e-1']?.topics).toEqual(TOPICS);
});

test('a Prep note starts from the uncovered topics', async ({ page }) => {
  await openLive(page, '/meetings');
  await row(page, 'Shield review')
    .getByRole('button', { name: 'More for “Shield review”' })
    .click();
  await page.getByRole('menuitem', { name: 'Prep note' }).click();
  await expect(page).toHaveURL(/\/projects\/p-echo$/);
  const box = page.getByRole('combobox', { name: 'New note' });
  await expect(box).toBeFocused();
  await expect(box).toHaveValue(
    `## Prep: Shield review — ${formatDay(shieldDay, today)}\n- North ridge\n- Probe droid sightings\n`,
  );
});

test('the Calendar counts a meeting’s topics', async ({ page }) => {
  // Today, so it is in this week's strip on a phone too.
  await openLive(page, '/meetings');
  await row(page, 'Shield review')
    .getByRole('button', { name: 'Shield review', exact: true })
    .click();
  const edit = page.getByRole('dialog', { name: 'Edit Shield review' });
  await edit.getByLabel('Date').fill('today');
  await edit.getByLabel('Date').press('Tab');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit).toBeHidden();

  await page.goto('/meetings?view=calendar');
  const chip = page
    .locator('[data-layout-id="e-1"]')
    .filter({ visible: true })
    .first();
  await expect(chip).toContainText('1/3');
  await expect(chip).toHaveAccessibleName(/1 of 3 topics/);
});

test('Summarize shows the model the topics', async ({ page }) => {
  await page.addInitScript(() => {
    (window as { __datapadFakeModel?: unknown }).__datapadFakeModel = {
      chunks: ['Fine.'],
      delayMs: 0,
    };
  });
  await openLive(page, '/meetings');
  await row(page, 'Shield review')
    .getByRole('button', { name: 'More for “Shield review”' })
    .click();
  await page.getByRole('menuitem', { name: 'Summarize' }).click();
  const dialog = page.getByRole('dialog', { name: 'Summary · Shield review' });
  await dialog
    .getByRole('button', { name: 'Download Qwen3 1.7B and summarize' })
    .click();
  await expect(dialog.getByText('Fine.')).toBeVisible();
  const sent = await page.evaluate(() =>
    JSON.stringify(
      (window as { __datapadFakeModel?: { lastRequest?: unknown } })
        .__datapadFakeModel?.lastRequest,
    ),
  );
  expect(sent).toContain('Topics:');
  expect(sent).toContain('- [x] Power budget — Approved');
  expect(sent).toContain('- [ ] North ridge');
});

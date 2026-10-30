import type { Page } from '@playwright/test';
import { addDays, longDay, weekday } from '../shared/dates';
import {
  chooseFilter,
  expect,
  expectNoSidewaysScroll,
  isMobile,
  openLive,
  SEED,
  test,
  today,
} from './fixtures';

// Inside this week, so the phone's week strip shows it too.
const day = () => (weekday(today()) === 6 ? today() : addDays(today(), 1));

async function pick(page: Page, name: string) {
  await page
    .getByRole('group', { name: /^Layout/ })
    .locator('label')
    .filter({ has: page.getByRole('radio', { name }) })
    .click();
  await expect(page.getByRole('radio', { name })).toBeChecked();
}

test.beforeEach(async ({ request }) => {
  const seed = structuredClone(SEED);
  seed.meetings['e-1'].date = day();
  await request.post('/api/import', { data: seed });
});

test('Calendar: open a day, add a meeting, see it in List', async ({
  page,
}) => {
  await openLive(page, '/meetings');
  await pick(page, 'Calendar');
  await expect(page).toHaveURL(/view=calendar/);

  const label = longDay(day(), today());
  if (!isMobile(page)) {
    const cell = page.getByRole('cell', {
      name: new RegExp(`^${label}, 1 meeting`),
    });
    await expect(
      cell.getByRole('button', { name: /Shield review/ }),
    ).toBeVisible();
  } else {
    await expect(
      page.getByRole('listitem', { name: new RegExp(`^${label}, 1 meeting`) }),
    ).toBeVisible();
  }

  await page.getByRole('button', { name: `Add a meeting on ${label}` }).click();
  const form = page.getByRole('dialog', { name: 'New meeting' });
  await expect(form.getByLabel('Date')).toHaveValue(day());
  await form.getByLabel('Title').fill('Hangar tour');
  await form.getByRole('button', { name: 'Add meeting' }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole('button', { name: /Hangar tour/ })).toBeVisible();

  // The chip opens the meeting's page; Back returns to the Calendar.
  await page.getByRole('button', { name: /Hangar tour/ }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Hangar tour' }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/view=calendar/);

  await pick(page, 'List');
  await expect(
    page.locator('[data-meeting-id]').filter({ hasText: 'Hangar tour' }),
  ).toBeVisible();
  await expectNoSidewaysScroll(page);
});

test('Calendar: a busy day overflows into a popover of rows', async ({
  page,
  request,
}) => {
  test.skip(isMobile(page), 'Phones list every meeting in the week strip.');
  const seed = structuredClone(SEED);
  const meetings = seed.meetings as Record<string, object>;
  // Only the four drills today: the seed's shield review is on today on a
  // Sunday (`day()`).
  for (const m of Object.values(seed.meetings)) {
    if (m.date === today()) m.date = addDays(today(), -60);
  }
  for (const n of [1, 2, 3, 4]) {
    meetings[`e-x${n}`] = {
      ...seed.meetings['e-1'],
      id: `e-x${n}`,
      title: `Drill ${n}`,
      date: today(),
      time: `0${n}:00`,
    };
  }
  await request.post('/api/import', { data: seed });
  await openLive(page, '/meetings?view=calendar');
  const cell = page.getByRole('cell', {
    name: `${longDay(today(), today())}, 4 meetings`,
  });
  await expect(cell).toHaveAttribute('aria-current', 'date');
  await cell.getByRole('button', { name: /^\+1 more/ }).click();
  const pop = page.getByRole('dialog');
  await expect(pop.locator('[data-meeting-id]')).toHaveCount(4);
  await expect(
    pop.getByRole('button', { name: 'More for “Drill 4”' }),
  ).toBeVisible();

  // Month navigation. Today's cell may still show as a leading day of the
  // next month's grid (when today falls in its first week), so what moves
  // is the month heading.
  await page.keyboard.press('Escape');
  const heading = page
    .getByRole('heading', { level: 3 })
    .filter({ visible: true });
  const thisMonth = (await heading.textContent())?.trim() ?? '';
  expect(thisMonth).toMatch(/^[A-Z][a-z]+ \d{4}$/);
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(heading).not.toHaveText(thisMonth);
  await expect(heading).toHaveText(/^[A-Z][a-z]+ \d{4}$/);
  await page
    .getByRole('button', { name: 'Today' })
    .filter({ visible: true })
    .click();
  await expect(heading).toHaveText(thisMonth);
  await expect(cell).toHaveAttribute('aria-current', 'date');
});

test('Timeline: a lane per project, meetings listed for assistive tech', async ({
  page,
}) => {
  await openLive(page, '/meetings?view=timeline');
  const list = page.getByRole('list', {
    name: 'Meetings over time, as a list',
  });
  await expect(list).toContainText('Echo Base relocation');
  await expect(list).toContainText('General');
  // Keyboard focus shows the list.
  const shield = list.getByRole('button', {
    name: 'Shield review',
    exact: true,
  });
  await shield.focus();
  await expect(list).toBeVisible();
  await shield.press('Enter');
  await expect(page).toHaveURL(/\/meetings\/e-1$/);
  await page.goBack();
  await expect(page).toHaveURL(/view=timeline/);

  // The project filter applies here too.
  await chooseFilter(page, 'Project', 'General');
  await expect(page).toHaveURL(/project=general/);
  await expect(list).not.toContainText('Echo Base relocation');
  await expect(list).toContainText('Quarterly planning');
  await expectNoSidewaysScroll(page);
});

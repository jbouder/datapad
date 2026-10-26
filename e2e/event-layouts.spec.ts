import type { Page } from '@playwright/test';
import { addDays, localDate, longDay, weekday } from '../shared/dates';
import {
  expect,
  expectNoSidewaysScroll,
  isMobile,
  openLive,
  SEED,
  test,
} from './fixtures';

const today = localDate(new Date());
// Inside this week, so the phone's week strip shows it too.
const day = weekday(today) === 6 ? today : addDays(today, 1);

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
  seed.events['e-1'].date = day;
  await request.post('/api/import', { data: seed });
});

test('Calendar: open a day, add an event, see it in List', async ({ page }) => {
  await openLive(page, '/events');
  await pick(page, 'Calendar');
  await expect(page).toHaveURL(/view=calendar/);

  const label = longDay(day, today);
  if (!isMobile(page)) {
    const cell = page.getByRole('cell', {
      name: new RegExp(`^${label}, 1 event`),
    });
    await expect(
      cell.getByRole('button', { name: /Shield review/ }),
    ).toBeVisible();
  } else {
    await expect(
      page.getByRole('listitem', { name: new RegExp(`^${label}, 1 event`) }),
    ).toBeVisible();
  }

  await page.getByRole('button', { name: `Add an event on ${label}` }).click();
  const form = page.getByRole('dialog', { name: 'New event' });
  await expect(form.getByLabel('Date')).toHaveValue(day);
  await form.getByLabel('Title').fill('Hangar tour');
  await form.getByRole('button', { name: 'Add event' }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole('button', { name: /Hangar tour/ })).toBeVisible();

  // The chip opens the event.
  await page.getByRole('button', { name: /Hangar tour/ }).click();
  const edit = page.getByRole('dialog', { name: 'Edit Hangar tour' });
  await expect(edit).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(edit).toBeHidden();

  await pick(page, 'List');
  await expect(
    page.locator('[data-event-id]').filter({ hasText: 'Hangar tour' }),
  ).toBeVisible();
  await expectNoSidewaysScroll(page);
});

test('Calendar: a busy day overflows into a popover of rows', async ({
  page,
  request,
}) => {
  test.skip(isMobile(page), 'Phones list every event in the week strip.');
  const seed = structuredClone(SEED);
  const events = seed.events as Record<string, object>;
  for (const n of [1, 2, 3, 4]) {
    events[`e-x${n}`] = {
      ...seed.events['e-1'],
      id: `e-x${n}`,
      title: `Drill ${n}`,
      date: today,
      time: `0${n}:00`,
    };
  }
  await request.post('/api/import', { data: seed });
  await openLive(page, '/events?view=calendar');
  const cell = page.getByRole('cell', {
    name: `${longDay(today, today)}, 4 events`,
  });
  await expect(cell).toHaveAttribute('aria-current', 'date');
  await cell.getByRole('button', { name: /^\+1 more/ }).click();
  const pop = page.getByRole('dialog');
  await expect(pop.locator('[data-event-id]')).toHaveCount(4);
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

test('Timeline: a lane per project, events listed for assistive tech', async ({
  page,
}) => {
  await openLive(page, '/events?view=timeline');
  const list = page.getByRole('list', { name: 'Events over time, as a list' });
  await expect(list).toContainText('Echo Base relocation');
  await expect(list).toContainText('General');
  // Keyboard focus shows the list.
  const shield = list.getByRole('button', { name: 'Shield review (Meeting)' });
  await shield.focus();
  await expect(list).toBeVisible();
  await shield.press('Enter');
  const edit = page.getByRole('dialog', { name: 'Edit Shield review' });
  await expect(edit).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(edit).toBeHidden();

  // The type filter applies here too.
  await page
    .locator('label')
    .filter({ hasText: /^Deadline$/ })
    .click();
  await expect(list).not.toContainText('Echo Base relocation');
  await expect(list).toContainText('Quarterly planning');
  await expectNoSidewaysScroll(page);
});

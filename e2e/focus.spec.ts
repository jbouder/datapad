import type { APIRequestContext, Page } from '@playwright/test';
import { addDays, endOfWeek, localDate } from '../shared/dates';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  expectSaved,
  openLive,
  SEED,
  test,
} from './fixtures';

const today = localDate(new Date());
const tomorrow = addDays(today, 1);
/** Tomorrow is still this week unless today is Sunday. */
const tomorrowBucket = tomorrow <= endOfWeek(today) ? 'This week' : 'Later';

/**
 * The seed with dates around today: one task in each bucket, a meeting
 * today (Day's agenda) and one tomorrow (only Week's).
 */
function seed() {
  const s = structuredClone(SEED);
  s.tasks['t-1'].due = addDays(today, -2); // Overdue (Leia's)
  s.tasks['t-4'].due = today; // Today
  s.tasks['t-5'].due = tomorrow; // This week, or Later on a Sunday
  s.tasks['t-6'].due = addDays(today, 30); // Later
  // t-2 has no date.
  s.meetings['e-1'].date = tomorrow;
  s.meetings['e-4'].date = today; // Quarterly planning, General
  return s;
}

async function stored(request: APIRequestContext) {
  return (await request.get('/api/export.json')).json() as Promise<{
    tasks: Record<string, { title: string; assignee: string }>;
  }>;
}

const bucket = (page: Page, name: string) =>
  page.getByRole('region', { name: 'Open tasks' }).getByRole('list', { name });

test.beforeEach(async ({ request }, info) => {
  if (!info.title.startsWith('nothing open')) {
    await request.post('/api/import', { data: seed() });
  }
});

test('open tasks fall into buckets by due date', async ({ page }) => {
  await openLive(page, '/?view=week');
  await expect(bucket(page, 'Overdue')).toContainText(
    'Confirm shield generator delivery',
  );
  await expect(bucket(page, 'Today')).toContainText('Book the tauntaun vet');
  // Later and No date start collapsed.
  await page.getByRole('button', { name: /^Later/ }).click();
  await page.getByRole('button', { name: /^No date/ }).click();
  await expect(bucket(page, tomorrowBucket)).toContainText(
    'Find a replacement motivator',
  );
  await expect(bucket(page, 'Later')).toContainText('Renew the docking permit');
  await expect(bucket(page, 'No date')).toContainText(
    'Insulate the hangar doors',
  );
  // Done tasks and archived projects stay out.
  await expect(page.getByText('2 projects · 5 open tasks')).toBeVisible();
});

test('closing a task takes it out of its bucket', async ({ page }) => {
  await openLive(page);
  // The checkbox is visually hidden; its label is what gets clicked.
  await bucket(page, 'Today')
    .locator('label', {
      has: page.getByRole('checkbox', {
        name: 'Close “Book the tauntaun vet”',
      }),
    })
    .click();
  await expect(bucket(page, 'Today')).toBeHidden();
  await expect(page.getByText('4 open tasks')).toBeVisible();
});

test('Mine is one keypress, lives in the URL and assigns quick-adds', async ({
  page,
  request,
}) => {
  await openLive(page);
  await page.locator('body').press('m');
  await expect(page).toHaveURL(/\?who=mine$/);
  // The filter comes before the rows (whose assignee pickers share the name).
  await expect(
    page.getByRole('combobox', { name: 'Assignee' }).first(),
  ).toContainText('Mine');
  // Only Leia's task is left.
  await expect(page.getByText('1 open task', { exact: false })).toBeVisible();
  await expect(bucket(page, 'Overdue')).toContainText(
    'Confirm shield generator delivery',
  );
  await expect(bucket(page, 'Today')).toBeHidden();

  const add = page.getByRole('textbox', { name: 'Add a task' });
  await add.fill('Calibrate the ion cannon');
  await add.press('Enter');
  // A no-date task opens its collapsed bucket so it can be seen.
  await expect(bucket(page, 'No date')).toContainText(
    'Calibrate the ion cannon',
  );
  await expectSaved(page);
  const added = Object.values((await stored(request)).tasks).find(
    (t) => t.title === 'Calibrate the ion cannon',
  );
  expect(added?.assignee).toBe('u-leia');

  // Reloading keeps the filter; m again goes back to Anyone.
  await page.reload();
  await expect(bucket(page, 'Overdue')).toBeVisible();
  await expect(page.getByText('2 open tasks')).toBeVisible();
  await page.locator('body').press('m');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('6 open tasks')).toBeVisible();
});

test('Day is the default: today only, with the rest of the week collapsed', async ({
  page,
}) => {
  await openLive(page);
  await expect(page.getByRole('radio', { name: 'Day' })).toBeChecked();
  const agenda = page.getByRole('region', { name: 'Today’s agenda' });
  await expect(agenda.getByRole('listitem')).toHaveCount(1);
  await expect(agenda).not.toContainText('Shield review');
  await expect(bucket(page, 'Today')).toContainText('Book the tauntaun vet');
  if (tomorrowBucket === 'This week') {
    await expect(bucket(page, 'This week')).toBeHidden();
    await page.getByRole('button', { name: /^This week/ }).click();
    await expect(bucket(page, 'This week')).toContainText(
      'Find a replacement motivator',
    );
  }
  await expectNoSidewaysScroll(page);
  await expectAccessible(page);
});

test('Week is a choice the URL and this browser remember', async ({ page }) => {
  await openLive(page);
  // The radio is visually hidden; its label is what gets clicked.
  await page
    .locator('label')
    .filter({ has: page.getByRole('radio', { name: 'Week' }) })
    .click();
  await expect(page).toHaveURL(/\?view=week$/);
  await expect(
    page.getByRole('region', { name: 'Next 7 days' }).getByRole('listitem'),
  ).toHaveCount(2);
  await expect(bucket(page, tomorrowBucket)).toBeVisible();
  // Back at / later, the last choice stands; v goes back to Day.
  await openLive(page);
  await expect(page.getByRole('radio', { name: 'Week' })).toBeChecked();
  await page.locator('body').press('v');
  await expect(page.getByRole('radio', { name: 'Day' })).toBeChecked();
  await expect(
    page.getByRole('region', { name: 'Today’s agenda' }),
  ).toBeVisible();
});

test('each agenda card links to its meeting', async ({ page }) => {
  await openLive(page, '/?view=week');
  const agenda = page.getByRole('region', { name: 'Next 7 days' });
  await expect(agenda.getByRole('listitem')).toHaveCount(2);
  await agenda.getByRole('link', { name: 'Shield review' }).click();
  await expect(page).toHaveURL(/\/meetings\/e-1$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Shield review' }),
  ).toBeVisible();
});

test('nothing open says what to do next', async ({ page }) => {
  await openLive(page);
  await expect(
    page.getByText('Nothing open. Add a task above or open a project.'),
  ).toBeVisible();
});

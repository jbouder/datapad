import type { Page } from '@playwright/test';
import { addDays, endOfWeek, formatDay, longDay } from '../shared/dates';
import { buildDigest, digestMarkdown, weekEnding } from '../shared/digest';
import { recapWindow } from '../shared/recap';
import type { Snapshot } from '../shared/types';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  openLive,
  recapSeed,
  SEED,
  test,
  today,
} from './fixtures';

/**
 * Today's week zoom and recap (#332). The week is Monday to Sunday around
 * the day; under it, the digest the Weekly digest page had. The recap
 * (`recapSeed()`: everything yesterday) shows above the timeline on the
 * days of its window, and today's line links to it.
 */

const title = (page: Page) => page.getByRole('heading', { level: 1 });
/** Day and Week are radios behind their labels. */
const week = (page: Page) =>
  page
    .locator('label')
    .filter({ has: page.getByRole('radio', { name: 'Week' }) })
    .click();
const dayButton = (page: Page, day: string) =>
  page.locator(`[data-week-day="${day}"] [data-week-day-button]`);

function weekTitle(day: string) {
  const to = endOfWeek(day);
  return `${formatDay(addDays(to, -6), today())} – ${formatDay(to, today())}`;
}

test('Week: seven days with their meetings, then the digest', async ({
  page,
  context,
  request,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await request.post('/api/import', { data: SEED });
  await openLive(page);
  await week(page);
  await expect(page).toHaveURL(/\?view=week$/);
  await expect(title(page)).toHaveText(weekTitle(today()));
  await expect(page.locator('[data-week-day]')).toHaveCount(7);
  await expect(dayButton(page, today())).toHaveAttribute(
    'aria-current',
    'date',
  );
  // Today's Shield review sits on today.
  await expect(page.locator(`[data-week-day="${today()}"]`)).toContainText(
    'Shield review',
  );
  await expectNoSidewaysScroll(page);
  await expectAccessible(page);

  // Copy as Markdown is the digest for the week ending its Sunday, the
  // text MCP's get_digest returns for that week.
  await page.getByRole('button', { name: 'Copy as Markdown' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const data = (await (
    await request.get('/api/export.json')
  ).json()) as Snapshot;
  expect(copied).toBe(
    digestMarkdown(buildDigest(data, weekEnding(endOfWeek(today())))),
  );
  await expect(page.locator('[data-digest]')).toContainText('Week of');

  // Previous and next step a week; Today comes back.
  await page.getByRole('button', { name: 'Previous week' }).click();
  await expect(title(page)).toHaveText(weekTitle(addDays(today(), -7)));
  await page.getByRole('button', { name: 'Next week' }).click();
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(title(page)).toHaveText(weekTitle(addDays(today(), 7)));
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(title(page)).toHaveText(weekTitle(today()));
});

test('the toggle and the days work from the keyboard', async ({
  page,
  request,
}) => {
  await request.post('/api/import', { data: SEED });
  await openLive(page);
  // v cycles Day and Week.
  await page.locator('body').press('v');
  await expect(page).toHaveURL(/\?view=week$/);
  await expect(page.locator('[data-week-day]')).toHaveCount(7);

  // Arrows, Home and End move between the days; Enter zooms into one.
  const days = page.locator('[data-week-day-button]');
  await days.nth(3).focus();
  await page.keyboard.press('Home');
  await expect(days.first()).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(days.nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(days.last()).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(days.nth(5)).toBeFocused();
  const picked = addDays(endOfWeek(today()), -1);
  await page.keyboard.press('Enter');
  await expect(page).not.toHaveURL(/view=week/);
  await expect(title(page)).toHaveText(longDay(picked, today()));
  await expect(page.getByRole('heading', { name: 'Timeline' })).toBeVisible();
});

test('/digest lands on the week zoom', async ({ page, request }) => {
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/digest');
  await expect(page).toHaveURL(/\/\?view=week$/);
  await expect(title(page)).toHaveText(weekTitle(today()));
  await expect(page.getByRole('region', { name: 'Digest' })).toBeVisible();
});

test('the recap: linked from today, above the last working day', async ({
  page,
  request,
}) => {
  await request.post('/api/import', { data: recapSeed() });
  await openLive(page);
  const window = recapWindow(today());
  const line = `${window.label}: 1 closed · 2 added · 1 meeting · 1 note`;
  // Not on today itself: today's line links to it.
  await expect(page.locator('[data-recap]')).toHaveCount(0);
  const link = page.locator('[data-recap-link]');
  await expect(link).toHaveText(line);
  await link.click();

  await expect(title(page)).toHaveText(longDay(window.from, today()));
  const recap = page.locator('[data-recap]');
  await expect(recap.locator('[data-recap-line]')).toHaveText(line);
  await expect(
    page.getByRole('list', { name: 'Closed: Echo Base relocation' }),
  ).toHaveText(/Order thermal blankets/);
  await expect(recap.getByText('Write the Yavin report')).toHaveCount(0);
  await expect(
    page.getByRole('list', { name: 'Added' }).getByRole('listitem'),
  ).toHaveText([/Restock the bacta tanks/, /Map the ice caves/]);
  await expect(page.locator('[data-recap-meeting="e-7"]')).toContainText(
    '2 of 3 topics covered · 1 action item · 1 note',
  );
  await expect(
    page.getByRole('list', { name: 'Activity: Echo Base relocation' }),
  ).toHaveText('Health set to yellow');
  // It sits above the timeline.
  const recapBox = await recap.boundingBox();
  const timelineBox = await page
    .getByRole('heading', { name: 'Timeline' })
    .boundingBox();
  expect(recapBox?.y ?? 0).toBeLessThan(timelineBox?.y ?? 0);
  await expectNoSidewaysScroll(page);
  await expectAccessible(page);

  // Every day of the window shows it.
  if (window.to !== window.from) {
    await page.getByRole('button', { name: 'Next day' }).click();
    await expect(recap.locator('[data-recap-line]')).toHaveText(line);
  }

  // Its rows open what they name.
  await recap.getByRole('button', { name: 'Restock the bacta tanks' }).click();
  const panel = page.getByRole('dialog', { name: 'Task' });
  await expect(panel.getByRole('textbox', { name: 'Title' })).toHaveValue(
    'Restock the bacta tanks',
  );
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  // Back to today: gone again.
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.locator('[data-recap]')).toHaveCount(0);
});

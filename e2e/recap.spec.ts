import type { Page } from '@playwright/test';
import { addDays, formatDay } from '../shared/dates';
import { recapTitle, recapWindow } from '../shared/recap';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  expectSaved,
  openLive,
  recapSeed,
  test,
  today,
} from './fixtures';

/**
 * Focus's Since yesterday (#258) over `recapSeed()`: everything in it is
 * yesterday, inside the window on any weekday (on a Monday, Friday
 * through Sunday; at the weekend, Friday through yesterday).
 */

const title = () => recapTitle(recapWindow(today()));
const label = () => recapWindow(today()).label;
const oneDay = () => {
  const w = recapWindow(today());
  return w.from === w.to;
};
const toggle = (page: Page) =>
  page.getByRole('button', { name: new RegExp(`^${title()}`) });
const recap = (page: Page) => page.locator('[data-recap]');

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: recapSeed() });
});

test('Since yesterday: closed, added, meetings held, notes and the rest of the activity', async ({
  page,
}) => {
  await openLive(page);
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-recap-line]')).toHaveText(
    `${label()}: 1 closed · 2 added · 1 meeting · 1 note`,
  );

  // Closed, by project; the archived Yavin report is not there.
  await expect(
    page.getByRole('list', { name: 'Closed: Echo Base relocation' }),
  ).toHaveText(/Order thermal blankets/);
  await expect(recap(page).getByText('Write the Yavin report')).toHaveCount(0);

  // Added, with the titles (five or fewer).
  await expect(
    page.getByRole('list', { name: 'Added' }).getByRole('listitem'),
  ).toHaveText([/Restock the bacta tanks/, /Map the ice caves/]);

  // The meeting held, with what came of it.
  const held = page.locator('[data-recap-meeting="e-7"]');
  await expect(held).toContainText('Ridge patrol debrief');
  await expect(held).toContainText(
    '2 of 3 topics covered · 1 action item · 1 note',
  );
  if (!oneDay()) {
    await expect(held).toContainText(formatDay(addDays(today(), -1), today()));
  }

  await expect(
    page.getByRole('list', { name: 'Notes written: Echo Base relocation' }),
  ).toHaveText(/Patrol found probe droid wreckage on the ridge/);

  // Activity: only what the rest does not already say.
  await expect(
    page.getByRole('list', { name: 'Activity: Echo Base relocation' }),
  ).toHaveText('Health set to yellow');

  await expectNoSidewaysScroll(page);
  await expectAccessible(page);
});

test('its rows open what they name', async ({ page }) => {
  await openLive(page);
  await recap(page)
    .getByRole('button', { name: 'Restock the bacta tanks' })
    .click();
  const panel = page.getByRole('dialog', { name: 'Task' });
  await expect(panel.getByRole('textbox', { name: 'Title' })).toHaveValue(
    'Restock the bacta tanks',
  );
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  await recap(page).getByRole('link', { name: 'Ridge patrol debrief' }).click();
  await expect(page).toHaveURL(/\/meetings\/e-7$/);

  await openLive(page);
  await recap(page)
    .getByRole('link', { name: 'Echo Base relocation' })
    .first()
    .click();
  await expect(page).toHaveURL(/\/projects\/p-echo$/);
});

test('Week shows the same; Mine narrows Closed and Added', async ({ page }) => {
  await openLive(page, '/?view=week');
  await expect(page.locator('[data-recap-line]')).toHaveText(
    `${label()}: 1 closed · 2 added · 1 meeting · 1 note`,
  );

  await openLive(page, '/?view=week&who=mine');
  // Leia is me: the ice caves are hers; nobody's blankets and tanks are not.
  await expect(page.locator('[data-recap-line]')).toHaveText(
    `${label()}: 1 added · 1 meeting · 1 note`,
  );
  await expect(
    page.getByRole('list', { name: 'Added' }).getByRole('listitem'),
  ).toHaveText([/Map the ice caves/]);
  await expect(
    recap(page).getByRole('heading', { name: /^Closed/ }),
  ).toHaveCount(0);
});

test('it closes and stays closed', async ({ page }) => {
  await openLive(page);
  const line = page.locator('[data-recap-line]');
  await expect(line).toBeVisible();
  await toggle(page).click();
  await expect(line).toBeHidden();
  await expectSaved(page);
  await page.reload();
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(line).toBeHidden();
});

import type { Page } from '@playwright/test';
import { addDays, endOfWeek, formatDay } from '../shared/dates';
import {
  briefingSeed,
  closeFilters,
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  expectSaved,
  isMobile,
  openFilters,
  openLive,
  test,
  today,
} from './fixtures';

/** Tomorrow is still this week unless today is Sunday. */
const tomorrowInWeek = () => addDays(today(), 1) <= endOfWeek(today());

const briefing = (page: Page) => page.getByRole('region', { name: 'Briefing' });
/** One of Due's priority groups (#218): High priority … No priority. */
const group = (page: Page, name: string) =>
  page.getByRole('region', { name: 'Due' }).getByRole('list', { name });
const groupTitles = (page: Page) =>
  page.getByRole('region', { name: 'Due' }).getByRole('heading', { level: 2 });
const section = (page: Page, name: string) =>
  page.getByRole('button', { name: new RegExp(`^${name}`) });
const agendaCard = (page: Page, id: string) =>
  page.locator(`[data-agenda-id="${id}"]`);

test.beforeEach(async ({ request }, info) => {
  if (!info.title.startsWith('nothing needs you')) {
    await request.post('/api/import', { data: briefingSeed() });
  }
});

test('the briefing: the week, the agenda’s prep, waiting on, attention, follow-ups and due', async ({
  page,
}) => {
  await openLive(page);
  await expect(page.locator('[data-movement]')).toHaveText(
    '1 closed this week · 1 added · 1 overdue',
  );

  // Today's Shield review: topics left and carried, last week's open
  // action items; it has a note, so no "no note yet".
  const shield = agendaCard(page, 'e-1');
  await expect(shield.locator('[data-prep]')).toHaveText(
    `2 of 3 topics left · 1 carried · 2 action items open from ${formatDay(addDays(today(), -7), today())}`,
  );

  // Waiting on: by name, Not on anyone last, each with how long.
  const waiting = page.locator('[data-waiting]');
  await expect(waiting).toHaveCount(2);
  await expect(waiting.nth(0)).toContainText('Leia Organa1· waiting 9 days');
  await expect(
    page.getByRole('list', { name: 'Waiting on Leia Organa' }),
  ).toContainText('Find a replacement motivator');
  await expect(waiting.nth(1)).toContainText('Not on anyone1· waiting 3 days');
  await expect(
    page.getByRole('list', { name: 'Waiting on Not on anyone' }),
  ).toContainText('Insulate the hangar doors');

  // Attention: red first, with its reasons; the paused Falcon is not here.
  const attention = page.getByRole('list', {
    name: 'Projects that need attention',
  });
  await expect(attention.getByRole('listitem')).toHaveCount(2);
  await expect(attention.getByRole('listitem').nth(0)).toContainText(
    'Endor shield bunker',
  );
  await expect(attention.getByRole('listitem').nth(0)).toContainText(
    'red · target in 6 days · quiet 16 days',
  );
  const echo = attention.getByRole('listitem').nth(1);
  await expect(echo).toContainText('Echo Base relocation');
  await expect(echo.locator('span').last()).toHaveText('yellow');

  // Follow-ups: last week's Shield review, its two open action items.
  const follow = page.locator('[data-follow-up="e-5"]');
  await expect(follow).toContainText(formatDay(addDays(today(), -7), today()));
  await expect(
    page
      .getByRole('list', { name: 'Action items from Shield review' })
      .getByRole('listitem'),
  ).toHaveText([/Draft the power budget/, /Send the ridge survey/]);

  // Due: overdue and today's in Day, by priority; nothing blocked, no
  // action item twice. The overdue one says so on its row.
  await expect(groupTitles(page)).toHaveText([
    /^High priority/,
    /^No priority/,
  ]);
  const overdue = group(page, 'High priority').locator('[data-task-id]', {
    hasText: 'Confirm shield generator delivery',
  });
  await expect(overdue).toBeVisible();
  await expect(
    overdue.locator('.text-destructive').filter({ visible: true }),
  ).toContainText('Overdue');
  await expect(group(page, 'No priority')).toContainText(
    'Book the tauntaun vet',
  );
  await expect(group(page, 'Low priority')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Overdue' })).toHaveCount(0);

  // The agenda: no Add note; no quick-add on the page.
  await expect(
    page.getByRole('region', { name: 'Today’s agenda' }).getByRole('button'),
  ).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Add a task' })).toHaveCount(
    0,
  );
  await expect(briefing(page).getByText('Send the ridge survey')).toHaveCount(
    1,
  );

  await expectNoSidewaysScroll(page);
  await expectAccessible(page);
});

test('group headers link to the person, the project and the meeting', async ({
  page,
}) => {
  await openLive(page);
  await page
    .locator('[data-waiting="u-leia"]')
    .getByRole('link', { name: 'Leia Organa' })
    .click();
  await expect(page).toHaveURL(/\/settings\/people\/u-leia$/);
  await openLive(page);
  await page
    .locator('[data-attention="p-endor"]')
    .getByRole('link', { name: 'Endor shield bunker' })
    .click();
  await expect(page).toHaveURL(/\/projects\/p-endor$/);
  await openLive(page);
  await page
    .locator('[data-follow-up="e-5"]')
    .getByRole('link', { name: 'Shield review' })
    .click();
  await expect(page).toHaveURL(/\/meetings\/e-5$/);
});

test('sections close and stay closed', async ({ page }) => {
  await openLive(page);
  const list = page.getByRole('list', {
    name: 'Projects that need attention',
  });
  await expect(section(page, 'Attention')).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await section(page, 'Attention').click();
  await expect(list).toBeHidden();
  await expectSaved(page);
  await page.reload();
  await expect(section(page, 'Waiting on')).toBeVisible();
  await expect(section(page, 'Attention')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(list).toBeHidden();
});

test('closing a task takes it out of its group', async ({ page }) => {
  await openLive(page);
  // The checkbox is visually hidden; its label is what gets clicked.
  await group(page, 'No priority')
    .locator('label', {
      has: page.getByRole('checkbox', {
        name: 'Close “Book the tauntaun vet”',
      }),
    })
    .click();
  await expect(group(page, 'No priority')).toBeHidden();
  await expect(page.locator('[data-movement]')).toHaveText(
    '2 closed this week · 1 added · 1 overdue',
  );
});

test('Mine narrows waiting on, follow-ups and due; n opens the new-task panel', async ({
  page,
}) => {
  await openLive(page);
  await page.locator('body').press('m');
  await expect(page).toHaveURL(/\?who=mine$/);
  // The filter is in the list toolbar (#271): the phone's Filters (1)
  // sheet; first on desktop, before the rows' assignee pickers.
  const filters = await openFilters(page);
  await expect(
    filters.getByRole('combobox', { name: 'Assignee' }).first(),
  ).toContainText('Mine');
  await expectAccessible(page);
  await closeFilters(page);
  if (isMobile(page)) {
    await expect(
      page.getByRole('button', { name: 'Filters (1)' }),
    ).toBeVisible();
  } else {
    // No Find: Focus is not a list.
    await expect(page.getByRole('searchbox', { name: 'Find' })).toHaveCount(0);
  }
  // Nothing blocked is Leia's; one action item and the overdue task are.
  await expect(section(page, 'Waiting on')).toBeHidden();
  await expect(
    page
      .getByRole('list', { name: 'Action items from Shield review' })
      .getByRole('listitem'),
  ).toHaveText([/Send the ridge survey/]);
  await expect(group(page, 'High priority')).toContainText(
    'Confirm shield generator delivery',
  );
  await expect(group(page, 'No priority')).toBeHidden();
  // Attention, the agenda and the week are everyone's.
  await expect(section(page, 'Attention')).toBeVisible();
  await expect(agendaCard(page, 'e-1')).toBeVisible();
  await expect(page.locator('[data-movement]')).toHaveText(
    '1 closed this week · 1 added · 1 overdue',
  );

  // No quick-add: n opens the new-task panel.
  await page.locator('body').press('n');
  const panel = page.getByRole('dialog', { name: 'New task' });
  await expect(panel.getByRole('textbox', { name: 'Title' })).toBeFocused();
  await panel
    .getByRole('textbox', { name: 'Title' })
    .fill('Calibrate the ion cannon');
  await panel.getByRole('textbox', { name: 'Title' }).press('Enter');
  await expect(panel).toBeHidden();
  await expect(page.locator('[data-movement]')).toHaveText(
    '1 closed this week · 2 added · 1 overdue',
  );
  await expectSaved(page);

  // Reloading keeps the filter; m again goes back to Anyone.
  await page.reload();
  await expect(group(page, 'High priority')).toBeVisible();
  await expect(section(page, 'Waiting on')).toBeHidden();
  await page.locator('body').press('m');
  await expect(page).toHaveURL(/\/$/);
  await expect(section(page, 'Waiting on')).toBeVisible();
});

test('Week widens the agenda and Due, and nothing else', async ({ page }) => {
  await openLive(page);
  await expect(page.getByRole('radio', { name: 'Day' })).toBeChecked();
  const day = page.getByRole('region', { name: 'Today’s agenda' });
  await expect(day.getByRole('listitem')).toHaveCount(1);
  await expect(agendaCard(page, 'e-6')).toHaveCount(0);

  // The radio is visually hidden; its label is what gets clicked.
  await page
    .locator('label')
    .filter({ has: page.getByRole('radio', { name: 'Week' }) })
    .click();
  await expect(page).toHaveURL(/\?view=week$/);
  const week = page.getByRole('region', { name: 'Next 7 days' });
  await expect(week.getByRole('listitem')).toHaveCount(2);
  await expect(agendaCard(page, 'e-6').locator('[data-prep]')).toHaveText(
    'no note yet',
  );
  if (tomorrowInWeek()) {
    await expect(group(page, 'Low priority')).toContainText(
      'Renew the docking permit',
    );
  }
  // Every agenda card is one height, whatever it holds (#218).
  const heights = await week
    .getByRole('listitem')
    .evaluateAll((cards) => cards.map((c) => c.getBoundingClientRect().height));
  expect(new Set(heights).size).toBe(1);
  // The same waiting, attention and follow-ups as Day.
  await expect(page.locator('[data-waiting]')).toHaveCount(2);
  await expect(
    page
      .getByRole('list', { name: 'Projects that need attention' })
      .getByRole('listitem'),
  ).toHaveCount(2);
  await expect(page.locator('[data-follow-up]')).toHaveCount(1);
  await expectNoSidewaysScroll(page);

  // Back at / later, the last choice stands; v goes back to Day.
  await openLive(page);
  await expect(page.getByRole('radio', { name: 'Week' })).toBeChecked();
  await page.locator('body').press('v');
  await expect(page.getByRole('radio', { name: 'Day' })).toBeChecked();
  await expect(group(page, 'Low priority')).toBeHidden();
});

test('each agenda card links to its meeting', async ({ page }) => {
  await openLive(page, '/?view=week');
  const agenda = page.getByRole('region', { name: 'Next 7 days' });
  await agenda.getByRole('link', { name: 'Han 1:1' }).click();
  await expect(page).toHaveURL(/\/meetings\/e-6$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Han 1:1' }),
  ).toBeVisible();
});

test('nothing needs you says what to do next', async ({ page }) => {
  await openLive(page);
  await expect(
    page.getByText(
      'Nothing needs you. Add a task with + or n, or open a project.',
    ),
  ).toBeVisible();
  await expect(page.locator('[data-movement]')).toHaveText(
    '0 closed this week · 0 added · 0 overdue',
  );
  await expectAccessible(page);
});

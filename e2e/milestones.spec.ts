import type { APIRequestContext, Page } from '@playwright/test';
import { addDays, formatDay } from '../shared/dates';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  expectSaved,
  isMobile,
  openLive,
  SEED,
  test,
  today,
} from './fixtures';

/** The seed, with Echo Base's milestones around today. */
function seeded() {
  const seed = structuredClone(SEED);
  seed.projects['p-echo'].milestones = [
    {
      id: 'm-past',
      title: 'Generator ordered',
      date: addDays(today(), -10),
    },
    { id: 'm-soon', title: 'Hangar doors hung', date: addDays(today(), 2) },
    { id: 'm-later', title: 'Base operational', date: addDays(today(), 20) },
  ];
  return seed;
}

interface Stored {
  projects: Record<
    string,
    { milestones?: Array<{ id: string; title: string; date: string }> }
  >;
}

async function milestonesOf(request: APIRequestContext, id: string) {
  const data = (await (await request.get('/api/export.json')).json()) as Stored;
  return data.projects[id]?.milestones ?? [];
}

const list = (page: Page) =>
  page.getByRole('list', { name: 'Milestones in Echo Base relocation' });
const row = (page: Page, id: string) =>
  page.locator(`[data-milestone-id="${id}"]`);

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: seeded() });
});

test('add, edit and delete milestones on the project page, with Undo', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-echo');
  // By date; the past one is muted.
  await expect(list(page).getByRole('listitem')).toHaveCount(3);
  await expect(list(page).getByRole('listitem').first()).toContainText(
    'Generator ordered',
  );
  await expect(row(page, 'm-past')).toHaveAttribute('data-past');
  await expect(row(page, 'm-soon')).not.toHaveAttribute('data-past');
  await expect(row(page, 'm-soon')).toContainText(
    formatDay(addDays(today(), 2), today()),
  );
  await expectNoSidewaysScroll(page);

  // Add: a title and a date; Enter in the date adds it.
  const add = page.getByRole('form', { name: 'Add a milestone' });
  const title = add.getByRole('textbox', { name: 'Milestone title' });
  const date = add.getByRole('textbox', { name: 'Milestone date' });
  // Esc clears what was typed.
  await title.fill('Never mind');
  await title.press('Escape');
  await expect(title).toHaveValue('');

  await title.fill('Tauntaun stables open');
  await date.fill('+5d');
  await date.press('Enter');
  await expect(list(page).getByRole('listitem')).toHaveCount(4);
  await expect(title).toHaveValue('');
  await expect(title).toBeFocused();
  // Sorted in by date: after the one in two days.
  await expect(list(page).getByRole('listitem').nth(2)).toContainText(
    'Tauntaun stables open',
  );
  await expectSaved(page);
  expect(
    (await milestonesOf(request, 'p-echo')).find(
      (m) => m.title === 'Tauntaun stables open',
    )?.date,
  ).toBe(addDays(today(), 5));

  // Edit in place: title and date; Enter saves, focus goes back to Edit.
  await page.getByRole('button', { name: 'Edit “Hangar doors hung”' }).click();
  const edit = page.getByRole('form', { name: /^Edit milestone/ });
  const editTitle = edit.getByRole('textbox', { name: 'Milestone title' });
  await expect(editTitle).toBeFocused();
  await editTitle.fill('Hangar doors sealed');
  await edit.getByRole('textbox', { name: 'Milestone date' }).fill('+7d');
  await edit.getByRole('textbox', { name: 'Milestone date' }).blur();
  await editTitle.press('Enter');
  await expect(edit).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Edit “Hangar doors sealed”' }),
  ).toBeFocused();
  // Moved after the stables (in five days).
  await expect(list(page).getByRole('listitem').nth(2)).toContainText(
    'Hangar doors sealed',
  );
  await expectSaved(page);
  expect(
    (await milestonesOf(request, 'p-echo')).find((m) => m.id === 'm-soon'),
  ).toEqual({
    id: 'm-soon',
    title: 'Hangar doors sealed',
    date: addDays(today(), 7),
  });

  // Esc cancels an edit.
  await page.getByRole('button', { name: 'Edit “Base operational”' }).click();
  await edit.getByRole('textbox', { name: 'Milestone title' }).fill('Oops');
  await edit.getByRole('textbox', { name: 'Milestone title' }).press('Escape');
  await expect(row(page, 'm-later')).toContainText('Base operational');

  // Delete, no confirm; Undo puts it back.
  await page
    .getByRole('button', { name: 'Delete “Hangar doors sealed”' })
    .click();
  await expect(row(page, 'm-soon')).toHaveCount(0);
  await expect(
    page.getByText('Deleted milestone “Hangar doors sealed”'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(row(page, 'm-soon')).toContainText('Hangar doors sealed');
  await expectSaved(page);
  expect(
    (await milestonesOf(request, 'p-echo')).map((m) => m.id).sort(),
  ).toContain('m-soon');
  await expectAccessible(page);
});

test('a project without milestones says how to add one', async ({ page }) => {
  await openLive(page, '/projects/p-falcon');
  await expect(page.getByText('No milestones. Add one above.')).toBeVisible();
});

test('touch targets are 44px on a phone', async ({ page }) => {
  test.skip(!isMobile(page), 'The phone sizes.');
  await openLive(page, '/projects/p-echo');
  for (const name of [
    'Edit “Hangar doors hung”',
    'Delete “Hangar doors hung”',
  ]) {
    const box = await page.getByRole('button', { name }).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
});

test('the card shows the next milestone', async ({ page }) => {
  await openLive(page, '/projects?status=all');
  const cards = page.getByRole('list', { name: 'Projects' });
  await expect(
    cards.getByRole('link', { name: /Echo Base relocation/ }),
  ).toContainText(
    `Hangar doors hung · ${formatDay(addDays(today(), 2), today())}`,
  );
  // None ahead: nothing shown.
  await expect(
    cards
      .getByRole('link', { name: /Falcon hyperdrive refit/ })
      .locator('[data-next-milestone]'),
  ).toHaveCount(0);
});

test('the table sorts by the next milestone', async ({ page }) => {
  test.skip(isMobile(page), 'The table is the desktop layout.');
  await openLive(page, '/projects?status=all&view=table');
  const table = page.getByRole('table', { name: 'Projects' });
  const next = table.getByRole('columnheader', { name: /Next milestone/ });
  await next.getByRole('button').click();
  await expect(page).toHaveURL(/sort=milestone/);
  await expect(next).toHaveAttribute('aria-sort', 'ascending');
  await expect(table.locator('tbody tr td:nth-child(1)')).toHaveText([
    'Echo Base relocation',
    'Falcon hyperdrive refit',
  ]);
});

test('the Timeline labels a milestone and opens the project at it', async ({
  page,
}) => {
  await openLive(page, '/projects?view=timeline');
  const point = page.locator('button[data-label="Hangar doors hung"]');
  const label = point.locator('+ .timeline-point-label');
  await expect(label).toHaveText(
    `Hangar doors hung · ${formatDay(addDays(today(), 2), today())}`,
  );
  if (!isMobile(page)) {
    await expect(label).toHaveCSS('opacity', '0');
    await point.hover();
    await expect(label).toHaveCSS('opacity', '1');
    // Keyboard: its entry in the list shows the same label.
    await page.mouse.move(0, 0);
    const entry = page
      .getByRole('list', { name: 'Projects, as a list' })
      .getByRole('button', { name: 'Hangar doors hung' });
    await entry.focus();
    await expect(label).toHaveAttribute('data-shown');
    await entry.blur();
    await expect(label).not.toHaveAttribute('data-shown');
  }
  await point.click();
  await expect(page).toHaveURL(/\/projects\/p-echo\?milestone=m-soon$/);
  await expect(row(page, 'm-soon')).toHaveAttribute('data-highlighted');
  await expect(row(page, 'm-soon')).toBeInViewport();
});

test('Focus lists a milestone in the next seven days', async ({ page }) => {
  await openLive(page, '/?view=week');
  const agenda = page.getByRole('region', { name: 'Next 7 days' });
  const card = agenda.locator('[data-kind="milestone"]');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Hangar doors hung');
  await expect(card).toContainText('Echo Base relocation');
  await expectNoSidewaysScroll(page);
  await card
    .getByRole('link', { name: 'Milestone: Hangar doors hung' })
    .click();
  await expect(page).toHaveURL(/\/projects\/p-echo\?milestone=m-soon$/);
  await expect(row(page, 'm-soon')).toHaveAttribute('data-highlighted');
});

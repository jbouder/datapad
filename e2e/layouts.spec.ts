import type { Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  isMobile,
  openLive,
  SEED,
  test,
} from './fixtures';

const layout = (page: Page) =>
  page.getByRole('group', { name: 'Layout (press v to cycle)' });

async function pick(page: Page, name: string) {
  await layout(page)
    .locator('label')
    .filter({ has: page.getByRole('radio', { name }) })
    .click();
  await expect(layout(page).getByRole('radio', { name })).toBeChecked();
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test.describe('every layout', () => {
  test.use({ reducedMotion: 'reduce' });
  for (const name of ['Table', 'Cards', 'Board', 'Timeline', 'Calendar']) {
    test(`${name} is axe clean`, async ({ page }) => {
      await openLive(page, '/dev/components');
      await pick(page, name);
      await expectAccessible(page);
      await expectNoSidewaysScroll(page);
    });
  }
});

test('the choice survives reload and navigation; the URL wins', async ({
  page,
}) => {
  await openLive(page, '/dev/components');
  await pick(page, 'Board');
  await expect(page).toHaveURL(/view=board/);
  await page.reload();
  await expect(
    layout(page).getByRole('radio', { name: 'Board' }),
  ).toBeChecked();
  // Without ?view=, this browser remembers.
  await page.goto('/dev/components');
  await expect(
    layout(page).getByRole('radio', { name: 'Board' }),
  ).toBeChecked();
  // With it, the URL wins.
  await page.goto('/dev/components?view=cards');
  await expect(
    layout(page).getByRole('radio', { name: 'Cards' }),
  ).toBeChecked();
});

test('v cycles layouts, but not while typing', async ({ page }) => {
  await openLive(page, '/dev/components?view=table');
  // The switcher (and its `v` listener) is on screen before the key goes.
  await expect(
    layout(page).getByRole('radio', { name: 'Table' }),
  ).toBeChecked();
  await page.locator('body').press('v');
  await expect(
    layout(page).getByRole('radio', { name: 'Cards' }),
  ).toBeChecked();
  await page.getByRole('textbox', { name: 'Add a task' }).fill('v');
  await expect(
    layout(page).getByRole('radio', { name: 'Cards' }),
  ).toBeChecked();
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('a switch is a plain cut', async ({ page }) => {
    await openLive(page, '/dev/components?view=table');
    const running = await page.evaluate(async () => {
      const seen = new Set<string>();
      const radio = document.querySelector<HTMLInputElement>(
        'input[value="cards"]',
      );
      radio?.click();
      const end = performance.now() + 800;
      while (performance.now() < end) {
        for (const a of document.getAnimations()) {
          if (a.playState === 'running')
            seen.add(String(a.effect?.getComputedTiming().duration));
        }
        await new Promise((r) => requestAnimationFrame(r));
      }
      return [...seen].filter((d) => d !== '0');
    });
    expect(running).toEqual([]);
  });
});

test('the table sorts, moves focus by row, opens and selects', async ({
  page,
}) => {
  test.skip(isMobile(page), 'The table is the desktop layout.');
  await openLive(page, '/dev/components?view=table');
  const table = page.getByRole('table', { name: 'Tasks' });
  const title = table.getByRole('columnheader', { name: /Title/ });
  await expect(title).toHaveAttribute('aria-sort', 'ascending');
  await title.getByRole('button').click();
  await expect(title).toHaveAttribute('aria-sort', 'descending');
  await expect(table.getByRole('rowheader').first()).toContainText(/\w/);

  const rows = table.locator('tr[data-row-id]');
  await rows.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press(' ');
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/^Would open “/)).toBeVisible();
  await table
    .getByRole('checkbox', { name: 'Select all in Echo Base relocation' })
    .check();
  await expect(
    table.locator(
      'tbody[data-group="Echo Base relocation"] tr[aria-selected="true"]',
    ),
  ).toHaveCount(4);
});

test('board cards move by menu, and the board scrolls inside its box', async ({
  page,
}) => {
  await openLive(page, '/dev/components?view=board');
  const board = page.getByRole('region', { name: 'Tasks by status' });
  await expect(board.getByRole('region', { name: 'Open' })).toBeVisible();
  await board
    .getByRole('button', { name: 'Move “Renew the docking permit” to…' })
    .click();
  await page.getByRole('menuitem', { name: 'Done' }).click();
  await expect(
    page.getByText('Would move “Renew the docking permit” to done'),
  ).toBeVisible();
  await expectNoSidewaysScroll(page);
});

test('the timeline lists its items for assistive tech; the calendar is a table', async ({
  page,
}) => {
  await openLive(page, '/dev/components?view=timeline');
  const list = page.getByRole('list', {
    name: 'Projects over time, as a list',
  });
  await expect(list).toContainText('Echo Base relocation');
  await expect(
    list.getByRole('button', { name: 'Base operational' }),
  ).toBeAttached();
  // Keyboard focus shows the list.
  await list.getByRole('button').first().focus();
  await expect(list).toBeVisible();

  // The calendar is a real table (a list of days on phones).
  await page.goto('/dev/components?view=calendar');
  if (isMobile(page)) {
    await expect(
      page.getByRole('list', { name: 'Meetings, this week' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next week' })).toBeVisible();
  } else {
    await expect(
      page.getByRole('table', { name: /^Meetings, / }),
    ).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Mon' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Next month' }),
    ).toBeVisible();
  }
});

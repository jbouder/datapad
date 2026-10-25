import type { Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  openLive,
  SEED,
  settle,
  test,
} from './fixtures';

const pick = async (page: Page, name: string) => {
  const group = page.getByRole('group', { name: 'Layout (press v to cycle)' });
  await group
    .locator('label')
    .filter({ has: page.getByRole('radio', { name }) })
    .click();
  await expect(group.getByRole('radio', { name })).toBeChecked();
};

/** Where an element sits on the page (not the viewport). */
async function place(page: Page, id: string) {
  return card(page, id).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top + window.scrollY, w: r.width, h: r.height };
  });
}

function card(page: Page, id: string) {
  return page.locator(`article[data-note-id="${id}"]`);
}

test.beforeEach(async ({ request }) => {
  const seed = structuredClone(SEED);
  seed.notes['n-3'].body = `## Next quarter\n${Array.from(
    { length: 14 },
    (_, i) => `- idea ${i + 1}`,
  ).join('\n')}`;
  await request.post('/api/import', { data: seed });
});

test('switch to Grid, expand a note, edit it in place, collapse', async ({
  page,
}) => {
  await openLive(page, '/notes');
  await pick(page, 'Grid');
  await expect(page).toHaveURL(/view=grid/);
  const grid = page.getByRole('list', { name: 'Notes' });
  await expect(grid).toBeVisible();

  // Pinned first; compact cards have no footer and clamp long notes.
  await expect(grid.locator('article').first()).toHaveAttribute(
    'data-note-id',
    'n-1',
  );
  await expect(
    card(page, 'n-3').getByRole('button', { name: 'Edit note' }),
  ).toHaveCount(0);
  await expect(card(page, 'n-3').getByText('idea 14')).not.toBeInViewport();

  await settle(page);
  const neighbor = await place(page, 'n-2');
  await card(page, 'n-3').getByRole('button', { name: 'Expand note' }).click();
  const open = card(page, 'n-3');
  await expect(
    open.getByRole('button', { name: 'Collapse note' }),
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(open.getByText('idea 14')).toBeVisible();
  // Opening covers; it does not push the other cards around.
  await settle(page);
  expect(await place(page, 'n-2')).toEqual(neighbor);

  await open.getByRole('button', { name: 'Edit note' }).click();
  const editor = open.getByRole('combobox', { name: 'Edit note' });
  await editor.fill('## Next quarter\nFewer moons.');
  await open.getByRole('button', { name: 'Save note' }).click();
  await expect(open.locator('h4')).toHaveText('Next quarter');
  await expect(open).toContainText('Fewer moons.');

  await page.keyboard.press('Escape');
  await expect(
    card(page, 'n-3').getByRole('button', { name: 'Expand note' }),
  ).toBeFocused();
  await expect(
    card(page, 'n-3').getByRole('button', { name: 'Edit note' }),
  ).toHaveCount(0);

  // Clicking a compact card opens it too.
  await card(page, 'n-2').getByText('Bring the power budget').click();
  await expect(
    card(page, 'n-2').getByRole('button', { name: 'Collapse note' }),
  ).toBeVisible();
});

test('filters apply to the Grid as well', async ({ page }) => {
  await openLive(page, '/notes?view=grid&pinned=1');
  await expect(
    page.getByRole('list', { name: 'Notes' }).locator('article'),
  ).toHaveCount(1);
  await pick(page, 'Feed');
  await expect(page.locator('article[data-note-id]')).toHaveCount(1);
});

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ theme, reducedMotion: 'reduce' });

    test('the grid and an open card are axe clean', async ({ page }) => {
      await openLive(page, '/notes?view=grid');
      await expectAccessible(page);
      await card(page, 'n-3')
        .getByRole('button', { name: 'Expand note' })
        .click();
      await expectAccessible(page);
    });
  });
}

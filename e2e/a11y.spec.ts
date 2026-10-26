import type { Page } from '@playwright/test';
import { addDays, localDate } from '../shared/dates';
import { THEMES, type ThemeOption } from '../src/lib/themes';
import {
  expect,
  expectAccessible,
  openPreferences,
  SEED,
  test,
} from './fixtures';

/**
 * Every theme a person can pick, axe-checked on its own: a token pair that
 * passes in test/themes.test.ts can still fail once composited (opacity,
 * translucent backgrounds). System is Light or Dark, both covered.
 *
 * Routes are added here as their views land (M2–M7).
 */
const CHECKED = THEMES.filter((t) => t.id !== 'system');
const ROUTES = [
  { path: '/', heading: 'Focus' },
  { path: '/projects', heading: 'Projects' },
  { path: '/archive', heading: 'Archived' },
  { path: '/tasks', heading: 'Tasks' },
  { path: '/notes', heading: 'Notes' },
  { path: '/meetings', heading: 'Meetings' },
  { path: '/settings', heading: 'Settings' },
  { path: '/people', heading: 'People' },
  { path: '/orgs', heading: 'Orgs' },
  { path: '/settings/data', heading: 'Settings' },
  { path: '/settings/account', heading: 'Settings' },
  { path: '/projects/nope', heading: 'Not found' },
  { path: '/help', heading: 'Help' },
  // The shared inputs (#19), only in the e2e build.
  { path: '/dev/components', heading: 'Components' },
];

/** The theme really applied, so a silent fallback to Light cannot pass. */
async function expectTheme(page: Page, theme: ThemeOption) {
  const html = page.locator('html');
  if (theme.base === 'dark') {
    await expect(html).toHaveClass(/\bdark\b/);
  } else {
    await expect(html).not.toHaveClass(/\bdark\b/);
  }
}

// Measured at rest: no entrance half-faded when contrast is checked.
test.use({ reducedMotion: 'reduce' });

for (const theme of CHECKED) {
  test.describe(`${theme.label} theme`, () => {
    test.use({ theme: theme.id });

    for (const route of ROUTES) {
      test(`${route.path}`, async ({ page }) => {
        await page.goto(route.path);
        await expectTheme(page, theme);
        await expect(
          page.getByRole('heading', { level: 1, name: route.heading }),
        ).toBeVisible();
        await expectAccessible(page);
      });
    }

    test('Focus with every bucket and the agenda', async ({
      page,
      request,
    }) => {
      const seed = structuredClone(SEED);
      const today = localDate(new Date());
      seed.tasks['t-1'].due = addDays(today, -1);
      seed.tasks['t-4'].due = today;
      seed.tasks['t-5'].due = addDays(today, 30);
      seed.meetings['e-1'].date = addDays(today, 1);
      await request.post('/api/import', { data: seed });
      await page.goto('/');
      for (const name of [/^Later/, /^No date/]) {
        await page.getByRole('button', { name }).click();
      }
      await expect(
        page.getByRole('region', { name: 'Next 7 days' }),
      ).toBeVisible();
      await expectAccessible(page);
    });

    test('People with a person selected', async ({ page, request }) => {
      const seed = structuredClone(SEED);
      seed.notes['n-1'].body = 'Ask @{u-han} about the hyperdrive';
      await request.post('/api/import', { data: seed });
      await page.goto('/people/u-han');
      await expect(page.locator('[data-person-id="u-han"]')).toBeVisible();
      await expectAccessible(page);
    });

    test('People as Cards', async ({ page, request }) => {
      await request.post('/api/import', { data: SEED });
      await page.goto('/people/u-han?view=cards');
      await expect(page.locator('[data-person-id="u-han"]')).toBeVisible();
      await expectAccessible(page);
    });

    test('with the project form open', async ({ page }) => {
      await page.goto('/projects');
      await page
        .getByRole('button', { name: 'New project', exact: true })
        .click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectAccessible(page);
    });

    test('a project with tasks', async ({ page, request }) => {
      await request.post('/api/import', { data: SEED });
      await page.goto('/projects/p-echo');
      await expect(page.locator('[data-task-id]').first()).toBeVisible();
      await expectAccessible(page);
    });

    test('the Tasks view with data and a selection', async ({
      page,
      request,
    }) => {
      await request.post('/api/import', { data: SEED });
      await page.goto('/tasks');
      await expect(
        page.locator('[data-task-title]').filter({ visible: true }).first(),
      ).toBeVisible();
      if ((page.viewportSize()?.width ?? 0) >= 820) {
        await page
          .getByRole('checkbox', { name: 'Select “Renew the docking permit”' })
          .click();
        await expect(
          page.getByRole('toolbar', { name: 'Selected tasks' }),
        ).toBeVisible();
      }
      await expectAccessible(page);
    });

    test('with the task panel open', async ({ page, request }) => {
      await request.post('/api/import', { data: SEED });
      await page.goto('/projects/p-echo');
      await page
        .locator('[data-task-id]')
        .first()
        .getByRole('button', {
          name: 'Confirm shield generator delivery',
          exact: true,
        })
        .click();
      await expect(page.getByRole('dialog', { name: 'Task' })).toBeVisible();
      await expectAccessible(page);
    });

    test('the Meetings view with data, Past open', async ({
      page,
      request,
    }) => {
      await request.post('/api/import', { data: SEED });
      await page.goto('/meetings');
      await page.getByRole('button', { name: /^Past/ }).click();
      await expect(page.locator('[data-meeting-id]').first()).toBeVisible();
      await expectAccessible(page);
    });

    for (const view of ['calendar', 'timeline']) {
      test(`the Meetings ${view}`, async ({ page, request }) => {
        await request.post('/api/import', { data: SEED });
        await page.goto(`/meetings?view=${view}`);
        await expect(
          page.getByRole('radio', {
            name: view === 'calendar' ? 'Calendar' : 'Timeline',
          }),
        ).toBeChecked();
        await expectAccessible(page);
      });
    }

    test('with the meeting form open', async ({ page, request }) => {
      await request.post('/api/import', { data: SEED });
      await page.goto('/meetings');
      await page.getByRole('button', { name: 'Add meeting' }).click();
      await expect(
        page.getByRole('dialog', { name: 'New meeting' }),
      ).toBeVisible();
      await expectAccessible(page);
    });

    test('with search open and results', async ({ page, request }) => {
      await request.post('/api/import', { data: SEED });
      await page.goto('/');
      await page.getByRole('button', { name: 'Search' }).click();
      await page
        .getByRole('dialog', { name: 'Search' })
        .getByRole('combobox')
        .fill('e');
      await expect(
        page.getByRole('group', { name: 'Tasks' }).getByRole('option').first(),
      ).toBeVisible();
      await expectAccessible(page);
    });

    test('with Preferences open', async ({ page }) => {
      await page.goto('/');
      await openPreferences(page);
      await expectAccessible(page);
    });
  });
}

test('the skip link reaches the main content', async ({ page }) => {
  test.skip(
    (page.viewportSize()?.width ?? 0) < 820,
    'Keyboard navigation is a desktop concern.',
  );
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
});

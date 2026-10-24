import type { Page } from '@playwright/test';
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
  { path: '/events', heading: 'Events' },
  { path: '/settings', heading: 'Settings' },
  { path: '/settings/people', heading: 'Settings' },
  { path: '/settings/orgs', heading: 'Settings' },
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

    test('the Events view with data, Past open', async ({ page, request }) => {
      await request.post('/api/import', { data: SEED });
      await page.goto('/events');
      await page.getByRole('button', { name: /^Past/ }).click();
      await expect(page.locator('[data-event-id]').first()).toBeVisible();
      await expectAccessible(page);
    });

    for (const view of ['calendar', 'timeline']) {
      test(`the Events ${view}`, async ({ page, request }) => {
        await request.post('/api/import', { data: SEED });
        await page.goto(`/events?view=${view}`);
        await expect(
          page.getByRole('radio', {
            name: view === 'calendar' ? 'Calendar' : 'Timeline',
          }),
        ).toBeChecked();
        await expectAccessible(page);
      });
    }

    test('with the event form open', async ({ page, request }) => {
      await request.post('/api/import', { data: SEED });
      await page.goto('/events');
      await page.getByRole('button', { name: 'Add event' }).click();
      await expect(
        page.getByRole('dialog', { name: 'New event' }),
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

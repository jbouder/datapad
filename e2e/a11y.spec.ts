import type { Page } from '@playwright/test';
import { THEMES, type ThemeOption } from '../src/lib/themes';
import {
  briefingSeed,
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
 * Every route empty (ROUTES), then every page and layout with the seed in
 * it (WITH_DATA), then the states that only show after a click: themes ×
 * the desktop and phone projects.
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
  { path: '/settings/pages', heading: 'Settings' },
  { path: '/settings/navigation', heading: 'Settings' },
  { path: '/settings/templates', heading: 'Settings' },
  { path: '/settings/summaries', heading: 'Settings' },
  { path: '/settings/spaces', heading: 'Settings' },
  { path: '/settings/people', heading: 'Settings' },
  { path: '/settings/orgs', heading: 'Settings' },
  { path: '/settings/data', heading: 'Settings' },
  { path: '/settings/connections', heading: 'Settings' },
  { path: '/settings/account', heading: 'Settings' },
  { path: '/digest', heading: 'Weekly digest' },
  { path: '/whiteboard', heading: 'Whiteboard' },
  { path: '/projects/nope', heading: 'Not found' },
  { path: '/help', heading: 'Help' },
  // The shared inputs (#19), only in the e2e build.
  { path: '/dev/components', heading: 'Components' },
];

/** Every page and layout with data in it (`e2e/seed.ts`). */
const WITH_DATA = [
  ...['cards', 'table', 'timeline'].map((v) => `/projects?view=${v}`),
  '/archive',
  ...['list', 'table', 'board', 'timeline'].map((v) => `/tasks?view=${v}`),
  '/tasks/t-2',
  ...['notepad', 'list', 'grid'].map((v) => `/notes?view=${v}`),
  '/notes?note=n-1',
  '/meetings/e-1',
  '/digest',
  '/projects/p-echo/whiteboard',
  '/settings/orgs',
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

    for (const path of WITH_DATA) {
      test(`${path} with data`, async ({ page, request }) => {
        await request.post('/api/import', { data: SEED });
        await page.goto(path);
        await expectTheme(page, theme);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expectAccessible(page);
      });
    }

    test('Focus with the whole briefing', async ({ page, request }) => {
      await request.post('/api/import', { data: briefingSeed() });
      await page.goto('/?view=week');
      await expect(
        page.getByRole('region', { name: 'Next 7 days' }),
      ).toBeVisible();
      await expect(
        page.getByRole('list', { name: 'Projects that need attention' }),
      ).toBeVisible();
      await expectAccessible(page);
    });

    test('People with a person selected', async ({ page, request }) => {
      const seed = structuredClone(SEED);
      seed.notes['n-1'].body = 'Ask @{u-han} about the hyperdrive';
      await request.post('/api/import', { data: seed });
      await page.goto('/settings/people/u-han');
      await expect(page.locator('[data-person-id="u-han"]')).toBeVisible();
      await expectAccessible(page);
    });

    test('People as Cards', async ({ page, request }) => {
      await request.post('/api/import', { data: SEED });
      await page.goto('/settings/people/u-han?view=cards');
      await expect(page.locator('[data-person-id="u-han"]')).toBeVisible();
      await expectAccessible(page);
    });

    test('with the project form open', async ({ page }) => {
      await page.goto('/projects');
      await page
        .getByRole('button', { name: 'Add project', exact: true })
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

test('forced colours keep the selected layout and current section visible', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/tasks');
  const outline = (el: Element) => getComputedStyle(el).outlineStyle;
  const checked = page
    .getByRole('group', { name: /^Layout/ })
    .locator('label:has(input:checked)');
  expect(await checked.evaluate(outline)).toBe('solid');
  const current = page
    .locator('[aria-current="page"]')
    .filter({ visible: true })
    .first();
  expect(await current.evaluate(outline)).toBe('solid');
  // No axe here: in forced colours the system theme picks every color,
  // so its contrast rule measures the authored ones and means nothing.
});

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

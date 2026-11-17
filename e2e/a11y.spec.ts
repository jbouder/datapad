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
  // Today's heading is the day: "Tuesday 17 November".
  { path: '/', heading: /^\w+day \d{1,2} \w+/ },
  { path: '/scratch', heading: 'Scratch' },
  { path: '/rooms', heading: 'Rooms' },
  { path: '/all', heading: 'All' },
  { path: '/all?kind=task', heading: 'All' },
  { path: '/people/nope', heading: 'Not found' },
  { path: '/settings', heading: 'Settings' },
  { path: '/settings/today', heading: 'Settings' },
  { path: '/settings/rooms', heading: 'Settings' },
  { path: '/settings/capture', heading: 'Settings' },
  { path: '/settings/all', heading: 'Settings' },
  { path: '/settings/templates', heading: 'Settings' },
  { path: '/settings/summaries', heading: 'Settings' },
  { path: '/settings/spaces', heading: 'Settings' },
  { path: '/settings/people', heading: 'Settings' },
  { path: '/settings/orgs', heading: 'Settings' },
  { path: '/settings/data', heading: 'Settings' },
  { path: '/settings/connections', heading: 'Settings' },
  { path: '/settings/account', heading: 'Settings' },
  { path: '/whiteboard', heading: 'Whiteboard' },
  { path: '/projects/nope', heading: 'Not found' },
  { path: '/help', heading: 'Help' },
  // The shared inputs (#19), only in the e2e build.
  { path: '/dev/components', heading: 'Components' },
];

/** Every page and layout with data in it (`e2e/seed.ts`). */
const WITH_DATA = [
  '/?view=week',
  '/all?show=rooms',
  '/all?kind=project&status=all',
  '/all?kind=project&status=all&view=cards',
  '/all?kind=project&status=all&view=timeline',
  '/all?kind=task',
  '/all?kind=task&view=table',
  '/all?kind=task&view=board',
  '/all?kind=meeting&status=all&view=calendar',
  '/projects/p-echo',
  '/all?kind=meeting&status=all',
  '/all?kind=note&note=n-1',
  '/scratch',
  '/rooms',
  '/all',
  '/meetings/e-1',
  '/people/u-han',
  '/projects/p-echo/plan',
  '/projects/p-echo?person=u-chewie',
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

    test('Today with every lane filled', async ({ page, request }) => {
      const seed = briefingSeed();
      Object.assign(seed.tasks['t-6'] ?? {}, { decide: true });
      await request.post('/api/import', { data: seed });
      await page.goto('/');
      await expect(page.getByRole('list', { name: 'To decide' })).toBeVisible();
      await expect(
        page.getByRole('list', { name: 'Waiting on Han Solo' }),
      ).toBeVisible();
      await expectAccessible(page);
    });

    test('A person’s room', async ({ page, request }) => {
      const seed = structuredClone(SEED);
      seed.notes['n-1'].body = 'Ask @{u-han} about the hyperdrive';
      await request.post('/api/import', { data: seed });
      await page.goto('/people/u-han');
      await expect(page.getByRole('list', { name: 'You owe' })).toBeVisible();
      await expectAccessible(page);
    });

    test('People as Cards', async ({ page, request }) => {
      await request.post('/api/import', { data: SEED });
      await page.goto('/settings/people?view=cards');
      await expect(page.getByRole('list', { name: 'People' })).toBeVisible();
      await expectAccessible(page);
    });

    test('with the project form open', async ({ page }) => {
      await page.goto('/all?show=rooms');
      await page.getByRole('button', { name: 'New project' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectAccessible(page);
    });

    test('a project with tasks', async ({ page, request }) => {
      await request.post('/api/import', { data: SEED });
      await page.goto('/projects/p-echo');
      await expect(page.locator('[data-loop]').first()).toBeVisible();
      await expectAccessible(page);
    });

    test('with the task panel open', async ({ page, request }) => {
      await request.post('/api/import', { data: SEED });
      await page.goto('/projects/p-echo');
      await page
        .locator('[data-loop]')
        .first()
        .getByRole('button', {
          name: 'Confirm shield generator delivery',
          exact: true,
        })
        .click();
      await expect(page.getByRole('dialog', { name: 'Task' })).toBeVisible();
      await expectAccessible(page);
    });

    test('with the meeting form open', async ({ page, request }) => {
      await request.post('/api/import', { data: SEED });
      await page.goto('/');
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

test('forced colours keep the pressed kind and current section visible', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/all?kind=task');
  const outline = (el: Element) => getComputedStyle(el).outlineStyle;
  const kind = page
    .getByRole('main')
    .getByRole('button', { name: 'Tasks', exact: true });
  expect(await kind.evaluate(outline)).toBe('solid');
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

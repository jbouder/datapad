import { expect, expectNoSidewaysScroll, test } from './fixtures';

/**
 * WCAG 1.4.10 Reflow and the phone layout. 320px is a 1280px window at
 * 400% zoom and the narrowest phone; 1280px is a laptop.
 */
const ROUTES = ['/', '/projects', '/tasks', '/settings/people', '/help'];

for (const width of [320, 1280]) {
  test.describe(`at ${width}px wide`, () => {
    test.use({ viewport: { width, height: 800 } });

    for (const path of ROUTES) {
      test(`${path} needs no sideways scrolling`, async ({ page }) => {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expectNoSidewaysScroll(page);
        await expect(
          page.getByRole('button', { name: 'Account and settings' }),
        ).toBeInViewport({ ratio: 1 });
        // The rail above 820px, the tab bar below: never both, never neither.
        const rail = page.getByRole('complementary', { name: 'Datapad' });
        const tabs = page
          .getByRole('navigation', { name: 'Sections' })
          .filter({ has: page.getByRole('link', { name: 'Meetings' }) })
          .last();
        if (width >= 820) {
          await expect(rail).toBeVisible();
          await expect(rail).toHaveCSS('width', '232px');
        } else {
          await expect(rail).toBeHidden();
          await expect(tabs).toBeInViewport({ ratio: 1 });
        }
      });
    }
  });
}

test.describe('on a phone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test('top bar and tab bar controls are at least 44px', async ({ page }) => {
    await page.goto('/');
    const banner = page.getByRole('banner');
    const controls = [
      banner.getByRole('button', { name: 'Account and settings' }),
      banner.getByRole('button', { name: 'Add task' }),
      banner.getByRole('button', { name: 'Write a note' }),
      banner.getByRole('link', { name: 'Help' }),
      ...['Focus', 'Projects', 'Tasks', 'Meetings', 'Notes'].map((name) =>
        page
          .getByRole('navigation', { name: 'Sections' })
          .last()
          .getByRole('link', { name, exact: true }),
      ),
    ];
    for (const control of controls) {
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box?.height ?? 0, String(control)).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0, String(control)).toBeGreaterThanOrEqual(44);
    }
  });

  test('the preferences menu fits on screen', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Account and settings' }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu).toBeInViewport({ ratio: 1 });
    await expectNoSidewaysScroll(page);
  });
});

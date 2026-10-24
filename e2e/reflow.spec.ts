import { expect, expectNoSidewaysScroll, test } from './fixtures';

/**
 * WCAG 1.4.10 Reflow and the phone layout. 320px is a 1280px window at
 * 400% zoom and the narrowest phone; 1280px is a laptop. M2 adds the rail
 * (desktop) and bottom tab bar (phone) assertions here.
 */
const ROUTES = ['/', '/help'];

for (const width of [320, 1280]) {
  test.describe(`at ${width}px wide`, () => {
    test.use({ viewport: { width, height: 800 } });

    for (const path of ROUTES) {
      test(`${path} needs no sideways scrolling`, async ({ page }) => {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expectNoSidewaysScroll(page);
        await expect(
          page.getByRole('button', { name: 'Preferences' }),
        ).toBeInViewport({ ratio: 1 });
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

  test('top bar controls are at least 44px', async ({ page }) => {
    await page.goto('/');
    for (const name of ['Preferences', 'Help']) {
      const box = await page
        .getByRole('banner')
        .getByRole(name === 'Help' ? 'link' : 'button', { name })
        .boundingBox();
      expect(box?.height ?? 0, name).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0, name).toBeGreaterThanOrEqual(44);
    }
  });

  test('the preferences menu fits on screen', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Preferences' }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu).toBeInViewport({ ratio: 1 });
    await expectNoSidewaysScroll(page);
  });
});

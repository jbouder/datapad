import type { Page } from '@playwright/test';
import { expect, openPreferences, settle, test } from './fixtures';

/**
 * Run `act` in the page, then watch every frame for the next second and
 * report each animation seen running (CSS, WAAPI and view transition
 * pseudo-elements all show up in `document.getAnimations()`).
 */
async function animationsDuring(
  page: Page,
  act: 'route' | 'theme',
): Promise<string[]> {
  await settle(page);
  return page.evaluate(
    (kind) =>
      new Promise<string[]>((resolve) => {
        const seen = new Set<string>();
        const label = (a: Animation) => {
          const effect = a.effect as KeyframeEffect | null;
          const target = effect?.target as HTMLElement | null;
          const name =
            a instanceof CSSAnimation
              ? a.animationName
              : a instanceof CSSTransition
                ? `transition:${a.transitionProperty}`
                : a.id || 'animation';
          return `${name} on ${target?.tagName.toLowerCase() ?? '?'}${effect?.pseudoElement ?? ''}`;
        };
        const end = performance.now() + 1000;
        const tick = () => {
          for (const a of document.getAnimations()) {
            if (a.playState === 'running') seen.add(label(a));
          }
          if (performance.now() < end) requestAnimationFrame(tick);
          else resolve([...seen]);
        };
        if (kind === 'route') {
          (document.querySelector('a[href="/help"]') as HTMLElement).click();
        } else {
          const item = [
            ...document.querySelectorAll('[role="menuitemradio"]'),
          ].find((el) => el.textContent?.includes('Tatooine')) as HTMLElement;
          item.click();
        }
        tick();
      }),
    act,
  );
}

test.describe('with prefers-reduced-motion: reduce', () => {
  test.use({ reducedMotion: 'reduce' });

  test('nothing animates through a route change', async ({ page }) => {
    await page.goto('/');
    expect(await animationsDuring(page, 'route')).toEqual([]);
  });

  test('nothing animates through a theme change', async ({ page }) => {
    await page.goto('/');
    await openPreferences(page);
    expect(await animationsDuring(page, 'theme')).toEqual([]);
  });
});

test.describe('with Preferences → Motion off', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('nothing animates through a route or theme change', async ({ page }) => {
    await page.goto('/');
    await openPreferences(page);
    await page.getByRole('menuitemcheckbox', { name: 'Motion' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'off');
    expect(await animationsDuring(page, 'theme')).toEqual([]);
    await page.keyboard.press('Escape');
    expect(await animationsDuring(page, 'route')).toEqual([]);
    // The choice is remembered on this device.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'off');
  });
});

// The control: the probes above are only worth something if they see motion
// when motion is on.
test.describe('with motion on', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('a route change runs the page transition', async ({ page }) => {
    await page.goto('/');
    const seen = await animationsDuring(page, 'route');
    expect(seen.join('\n')).toMatch(/page-(in|out)/);
  });
});

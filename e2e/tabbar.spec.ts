import type { Page } from '@playwright/test';
import {
  expect,
  isMobile,
  openLive,
  openPreferences,
  SEED,
  syncStatus,
  test,
} from './fixtures';

/**
 * The phone's tab bar through view transitions (#219): it used to sit in
 * the root snapshot, under the moving page, so the page showed through
 * it. Now it has its own snapshot, opaque, and never animates.
 */

interface Seen {
  type: string | undefined;
  name: string;
  background: string;
  /** Animations running on the tab bar's pseudo-elements. */
  tabbar: string[];
  /** Whether anything else was animating (so a transition really ran). */
  others: number;
}

/** Record, as each view transition starts, how the tab bar is drawn. */
async function watchTransitions(page: Page) {
  await page.addInitScript(() => {
    const seen: unknown[] = [];
    (window as { __vtSeen?: unknown[] }).__vtSeen = seen;
    const start = document.startViewTransition?.bind(document);
    if (!start) return;
    document.startViewTransition = ((update: () => void) => {
      const transition = start(update);
      transition.ready
        .then(() => {
          const nav = document.querySelector('.vt-tabbar');
          const style = nav ? getComputedStyle(nav) : null;
          const running = document
            .getAnimations()
            .filter((a) => a.playState === 'running')
            .map(
              (a) => (a.effect as KeyframeEffect | null)?.pseudoElement ?? '',
            );
          seen.push({
            type: document.documentElement.dataset.vt,
            name: style?.viewTransitionName ?? '',
            background: style?.backgroundColor ?? '',
            tabbar: running.filter((p) => p.includes('tabbar')),
            others: running.filter((p) => !p.includes('tabbar')).length,
          });
        })
        .catch(() => undefined);
      return transition;
    }) as typeof document.startViewTransition;
  });
}

const seen = (page: Page) =>
  page.evaluate(() => (window as { __vtSeen?: Seen[] }).__vtSeen ?? []);

/** No alpha below 1 in a computed color (rgb(), oklch(), color()). */
function opaque(color: string): boolean {
  if (/^rgba\(/.test(color)) return /,\s*1\)$/.test(color);
  const alpha = /\/\s*([\d.]+)\)$/.exec(color);
  return !alpha || Number(alpha[1]) === 1;
}

const tabs = (page: Page) => page.getByRole('navigation', { name: 'Sections' });

test.beforeEach(async ({ page, request }) => {
  test.skip(!isMobile(page), 'the tab bar is the phone’s navigation');
  await request.post('/api/import', { data: SEED });
});

test.describe('with motion on', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('the tab bar stays opaque and still through page, layout and space transitions', async ({
    page,
    request,
  }) => {
    await request.post('/api/spaces/create', { data: { name: 'Personal' } });
    await watchTransitions(page);
    await openLive(page, '/');

    // A page change.
    await tabs(page).getByRole('link', { name: 'Tasks' }).click();
    await expect(page).toHaveURL(/\/tasks/);
    await expect.poll(async () => (await seen(page)).length).toBe(1);

    // A layout change.
    const group = page.getByRole('group', { name: /^Layout/ });
    await group
      .locator('label')
      .filter({ has: page.getByRole('radio', { checked: false }) })
      .first()
      .click();
    await expect.poll(async () => (await seen(page)).length).toBe(2);

    // A space change (the account menu on a phone).
    await openPreferences(page);
    await page.getByRole('menuitemradio', { name: 'Personal' }).click();
    await expect(syncStatus(page)).toHaveAttribute('data-status', 'live');
    await expect.poll(async () => (await seen(page)).length).toBe(3);

    const all = await seen(page);
    expect(all.map((s) => s.type)).toEqual(['page', 'layout', 'space']);
    for (const s of all) {
      expect(s.name, s.type).toBe('tabbar');
      expect(opaque(s.background), `${s.type}: ${s.background}`).toBe(true);
      expect(s.tabbar, s.type).toEqual([]);
    }
    // The page itself did move.
    expect(all[0]?.others).toBeGreaterThan(0);

    // Between transitions it is the usual translucent bar again.
    await expect(tabs(page)).toHaveCSS('view-transition-name', 'none');
  });
});

test.describe('with prefers-reduced-motion: reduce', () => {
  test.use({ reducedMotion: 'reduce' });

  test('no transition runs, so the tab bar never changes', async ({ page }) => {
    await watchTransitions(page);
    await openLive(page, '/');
    await tabs(page).getByRole('link', { name: 'Tasks' }).click();
    await expect(page).toHaveURL(/\/tasks/);
    await tabs(page).getByRole('link', { name: 'Projects' }).click();
    await expect(page).toHaveURL(/\/projects/);
    expect(await seen(page)).toEqual([]);
    await expect(tabs(page)).toHaveCSS('view-transition-name', 'none');
  });
});

test.describe('with Motion off', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('no transition runs, so the tab bar never changes', async ({ page }) => {
    await watchTransitions(page);
    await openLive(page, '/');
    await openPreferences(page);
    await page.getByRole('menuitemcheckbox', { name: 'Motion' }).click();
    await page.keyboard.press('Escape');
    await tabs(page).getByRole('link', { name: 'Tasks' }).click();
    await expect(page).toHaveURL(/\/tasks/);
    expect(await seen(page)).toEqual([]);
    await expect(tabs(page)).toHaveCSS('view-transition-name', 'none');
  });
});

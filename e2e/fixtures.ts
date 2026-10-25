import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import {
  type BrowserContext,
  test as base,
  expect,
  type Page,
} from '@playwright/test';
import type { ThemeId } from '../src/lib/themes';
import { SEED, SEED_COUNTS } from './seed';

export { expect, SEED, SEED_COUNTS };

/**
 * Nothing leaves localhost: fonts are bundled and Datapad talks only to its
 * own origin, so any other request is a bug (and is blocked here).
 */
async function offline(context: BrowserContext) {
  await context.route(
    (url) => url.hostname !== 'localhost',
    (route) => route.abort('blockedbyclient'),
  );
}

/** Save `theme` in this context's storage before any page loads. */
async function useTheme(context: BrowserContext, theme: ThemeId | null) {
  if (theme !== null) {
    await context.addInitScript((id) => {
      localStorage.setItem('datapad:theme', id);
    }, theme);
  }
}

interface Options {
  /** The theme every context starts in; null leaves it on System. */
  theme: ThemeId | null;
}

interface Fixtures {
  /**
   * The address this test is signed in as. The dev Access bypass honors the
   * `x-dev-access-email` header (only while ACCESS_AUD is empty), so every
   * test gets its own, empty Durable Object.
   */
  email: string;
}

export const test = base.extend<Options & Fixtures>({
  theme: [null, { option: true }],
  // biome-ignore lint/correctness/noEmptyPattern: Playwright needs the destructuring.
  email: async ({}, use) => {
    await use(`e2e-${randomUUID()}@datapad.test`);
  },
  extraHTTPHeaders: async ({ extraHTTPHeaders, email }, use) => {
    await use({ ...extraHTTPHeaders, 'x-dev-access-email': email });
  },
  context: async ({ context, theme }, use) => {
    await offline(context);
    await useTheme(context, theme);
    await use(context);
  },
});

/** Whether this test runs in the phone project. */
export function isMobile(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 820;
}

/** Open the account menu (Settings, Theme, Motion, Sign out). */
export async function openPreferences(page: Page) {
  await page.getByRole('button', { name: 'Account and settings' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
}

/** No sideways scrolling (WCAG 1.4.10 Reflow). */
export async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Every finite animation has finished (entrances, view transitions). */
export async function settle(page: Page) {
  await expect(page.locator('html')).not.toHaveAttribute('data-vt');
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

/**
 * axe-core over the whole page against WCAG 2.2 A and AA, open menus and
 * dialogs and the page under them alike. Soft, so one run lists every
 * failure, not just the first.
 */
export async function expectAccessible(page: Page) {
  // Let entrances finish so contrast is measured at rest, and start from
  // the top: a target scrolled under the sticky header reads as obscured.
  await settle(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const summary = violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => `${n.target.join(' ')}: ${n.html.slice(0, 160)}`),
  }));
  expect.soft(summary).toEqual([]);
}

/**
 * The sync status. The rail has one (desktop) and the top bar a compact
 * copy (phones); the rail's comes first and is always in the DOM.
 */
export function syncStatus(page: Page) {
  return page.locator('[data-status]').first();
}

/** Load a page and wait for the socket's first snapshot. */
export async function openLive(page: Page, path = '/') {
  await page.goto(path);
  await expect(syncStatus(page)).toHaveAttribute('data-status', 'live');
}

/** Every change has reached the server (the sync status says Saved). */
export async function expectSaved(page: Page) {
  await expect(syncStatus(page)).toHaveAttribute('data-status', 'live');
  await expect(syncStatus(page)).toContainText('Saved');
}

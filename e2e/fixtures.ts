import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import {
  type BrowserContext,
  test as base,
  expect,
  type Locator,
  type Page,
} from '@playwright/test';
import type { ThemeId } from '../src/lib/themes';
import {
  briefingSeed,
  recapSeed,
  refreshSeed,
  SEED,
  SEED_COUNTS,
  seedDay,
  seedTime,
  today,
} from './seed';

/**
 * Dates in specs. The suite passes on any date, at any time of day and in
 * any timezone (`E2E_TZ`, UTC by default, sets both the runner's and the
 * browser's), without faking a clock:
 *
 * - Never compute `today` when a file loads: call `today()` inside the test
 *   (or the helper it calls), so a run that crosses midnight stays right.
 * - Never write a literal date, or a formatted one, for something the seed
 *   holds. `SEED` is shifted to today before every test, so the export's
 *   dates move; `seedDay('2026-11-14')` is where one landed, and the app's
 *   own formatters (`formatDay`, `longDay`, …) say how it reads.
 * - Dates a test sets up go relative to `today()` (`addDays(today(), 3)`),
 *   and allow for the seed's own around them.
 */
export {
  briefingSeed,
  expect,
  type Locator,
  recapSeed,
  SEED,
  SEED_COUNTS,
  seedDay,
  seedTime,
  today,
};

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
  /** Rebuilds `SEED` for today before every test (automatic). */
  freshSeed: undefined;
  /**
   * The address this test is signed in as. The dev Access bypass honors the
   * `x-dev-access-email` header (only while ACCESS_AUD is empty), so every
   * test gets its own, empty Durable Object.
   */
  email: string;
}

export const test = base.extend<Options & Fixtures>({
  theme: [null, { option: true }],
  freshSeed: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright needs the destructuring.
    async ({}, use) => {
      refreshSeed();
      await use(undefined);
    },
    { auto: true },
  ],
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

/** Open the account menu (Settings, Help, Theme, Motion, Sign out). */
export async function openPreferences(page: Page) {
  await page.getByRole('button', { name: 'Account and settings' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
}

/** Help, from the account menu. */
export async function openHelp(page: Page) {
  await openPreferences(page);
  await page.getByRole('menuitem', { name: 'Help' }).click();
}

/**
 * A detail page's More menu (a project's, a meeting's, a task's): the
 * names it offers, closed again.
 */
export async function moreActions(page: Page): Promise<string[]> {
  await page.getByRole('button', { name: 'More actions' }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const names = (await menu.getByRole('menuitem').allInnerTexts()).map((n) =>
    n.trim(),
  );
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  return names;
}

/** One action from a detail page's More menu. */
export async function moreAction(page: Page, name: string) {
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

/**
 * A list page's filters (#269): in the toolbar on desktop, in the Filters
 * sheet on phones (opened here). Returns where the controls are.
 */
export async function openFilters(page: Page): Promise<Locator> {
  if (!isMobile(page)) return page.getByRole('main');
  const sheet = page.getByRole('dialog', { name: 'Filters' });
  if (!(await sheet.isVisible())) {
    await page.getByRole('button', { name: /^Filters/ }).click();
  }
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Close the phone's Filters sheet (Done); nothing on desktop. */
export async function closeFilters(page: Page) {
  if (!isMobile(page)) return;
  const sheet = page.getByRole('dialog', { name: 'Filters' });
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(sheet).toBeHidden();
}

/** Pick `option` in a list page's filter or Sort select, wherever it is. */
export async function chooseFilter(page: Page, label: string, option: string) {
  const scope = await openFilters(page);
  await scope.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await closeFilters(page);
}

/** The top bar's + menu: Add task or Write a note by default. */
export async function addFromTopBar(
  page: Page,
  item: 'Add task' | 'Write a note' | 'Add meeting' | 'Add project',
) {
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Add', exact: true })
    .click();
  await page.getByRole('menuitem', { name: item }).click();
}

/**
 * Add a task with `n` and the new-task panel (no page has a quick-add
 * since #218): the title, Enter, and the panel closes.
 */
export async function addTask(page: Page, title: string) {
  await page.locator('body').press('n');
  const panel = page.getByRole('dialog', { name: 'New task' });
  const input = panel.getByRole('textbox', { name: 'Title' });
  await expect(input).toBeFocused();
  await input.fill(title);
  await input.press('Enter');
  await expect(panel).toBeHidden();
}

/**
 * Notes in its List, with these notes opened (each row opens its note in
 * place, #218): `ids` or, with none, every row.
 */
export async function openNotes(page: Page, query = '', ids?: string[]) {
  const params = new URLSearchParams(query);
  if (!params.has('view')) params.set('view', 'list');
  await openLive(page, `/notes?${params}`);
  const list = page.getByRole('main');
  const rows = ids
    ? ids.map((id) => list.locator(`li[data-note-id="${id}"]`))
    : await list.locator('li[data-note-id]:has(button)').all();
  for (const row of rows) await openNoteRow(row);
}

/**
 * A compact note row (#273: a project's, meeting's or task's notes, on
 * the page or in the panel) holding `text`.
 */
export function noteRow(scope: Page | Locator, text: string | RegExp) {
  return scope.locator('li[data-note-id]').filter({ hasText: text });
}

/** Open a note row in place (no-op when it is open). */
export async function openNoteRow(row: Locator) {
  const toggle = row.getByRole('button', { name: /^Note from / });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

/** One action from a note row's ⋯ menu (Edit, Pin, Make task…). */
export async function noteAction(row: Locator, name: string) {
  await row.getByRole('button', { name: /^More for note from / }).click();
  await row.page().getByRole('menuitem', { name, exact: true }).click();
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
 * The sync status: the rail's (desktop) comes first in the DOM, the top
 * bar's (phones) after; whichever is hidden still carries the state.
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

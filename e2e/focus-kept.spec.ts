import type { Page } from '@playwright/test';
import { expect, openLive, SEED, test } from './fixtures';

/**
 * Focus is never lost (#53): after a panel closes, a toast goes, the page
 * changes or the layout switches, `document.activeElement` is still
 * something on the page, never `<body>` or a node that was removed. A
 * keyboard or screen reader user would otherwise start again from the
 * top.
 */

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

/** What has focus: a connected element other than `<body>`. */
async function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body || !el.isConnected) return 'lost';
    return (
      el.getAttribute('aria-label') ||
      el.textContent?.trim().slice(0, 40) ||
      el.tagName
    );
  });
}

async function expectKept(page: Page) {
  await expect.poll(() => focused(page)).not.toBe('lost');
}

function taskButton(page: Page, title: string) {
  return page
    .locator('[data-task-id]')
    .filter({ hasText: title })
    .getByRole('button', { name: title, exact: true });
}

test('closing a panel puts focus back on what opened it', async ({ page }) => {
  await openLive(page, '/projects/p-echo');
  const opener = taskButton(page, 'Confirm shield generator delivery');
  await opener.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Task' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(opener).toBeFocused();
});

test('a panel whose opener is gone leaves focus on the page', async ({
  page,
}) => {
  await openLive(page, '/projects/p-echo');
  await taskButton(page, 'Insulate the hangar doors').focus();
  await page.keyboard.press('Enter');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expectKept(page);
});

test('a toast keeps focus when its button is used, and waits while focused', async ({
  page,
}) => {
  await openLive(page, '/projects/p-echo');
  await taskButton(page, 'Insulate the hangar doors').click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete', exact: true })
    .click();
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await undo.focus();
  // Past the five seconds it would otherwise stay for.
  await page.waitForTimeout(5500);
  await expect(undo).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(undo).toBeHidden();
  await expect(taskButton(page, 'Insulate the hangar doors')).toBeVisible();
  await expectKept(page);
});

test('following a link in the page moves focus to the new page', async ({
  page,
}) => {
  await openLive(page, '/projects?view=table');
  const link = page
    .locator('#main')
    .getByRole('link', { name: 'Echo Base relocation' })
    .first();
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Echo Base relocation' }),
  ).toBeVisible();
  await expectKept(page);
  // Somewhere in the new page, so the next Tab goes on from there.
  expect(
    await page.evaluate(() =>
      document.getElementById('main')?.contains(document.activeElement),
    ),
  ).toBe(true);
});

test('switching layout keeps focus on the switcher', async ({ page }) => {
  await openLive(page, '/tasks?view=list');
  const layouts = page.getByRole('group', { name: /^Layout/ });
  await layouts.getByRole('radio', { name: 'List' }).focus();
  await page.keyboard.press('ArrowRight');
  const next = layouts.getByRole('radio', { checked: true });
  await expect(next).not.toHaveAccessibleName('List');
  await expect(next).toBeFocused();
  await expectKept(page);
});

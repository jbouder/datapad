import type { APIRequestContext, Locator } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  expectSaved,
  isMobile,
  noteAction,
  noteRow,
  openLive,
  openNoteRow,
  SEED,
  test,
} from './fixtures';

/** Compact note rows (#273) on project, meeting and task pages. */

async function stored(
  request: APIRequestContext,
): Promise<{ notes: Record<string, { body: string; pinned: boolean }> }> {
  return (await request.get('/api/export.json')).json();
}

const toggle = (row: Locator) =>
  row.getByRole('button', { name: /^Note from / });
const more = (row: Locator) =>
  row.getByRole('button', { name: /^More for note from / });

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test('a closed row is short; it opens in place and closes again', async ({
  page,
}) => {
  await openLive(page, '/projects/p-echo');
  const standup = noteRow(page, 'Standup');
  await expect(toggle(standup)).toHaveAttribute('aria-expanded', 'false');

  // Closed: plain text, two lines at most, no rendered Markdown.
  const preview = standup.locator('[data-note-preview]');
  await expect(preview).toContainText('Standup');
  await expect(preview).toContainText('Tauntauns fed');
  await expect(standup.getByRole('checkbox')).toHaveCount(0);
  await expect(standup.locator('.mention')).toHaveCount(0);
  const lines = await preview.evaluate((el) => {
    const style = getComputedStyle(el);
    return el.clientHeight / Number.parseFloat(style.lineHeight);
  });
  expect(lines).toBeLessThanOrEqual(2.1);
  await expect(standup).toContainText('Pinned');

  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  // A click on the preview opens it: the whole note, rendered.
  await preview.click();
  await expect(toggle(standup)).toHaveAttribute('aria-expanded', 'true');
  await expect(standup.locator('.mention')).toHaveText('@Chewbacca');
  await expect(
    standup.getByRole('checkbox', { name: 'Check the heaters' }),
  ).toBeVisible();
  await expectAccessible(page);

  // The toggle closes it.
  await toggle(standup).click();
  await expect(toggle(standup)).toHaveAttribute('aria-expanded', 'false');
  await expect(standup.getByRole('checkbox')).toHaveCount(0);
});

test('the keyboard opens a row and its menu', async ({ page, request }) => {
  test.skip(isMobile(page), 'A keyboard concern.');
  await openLive(page, '/projects/p-echo');
  const prep = noteRow(page, 'Bring the power budget');

  await toggle(prep).focus();
  await page.keyboard.press('Enter');
  await expect(toggle(prep)).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Space');
  await expect(toggle(prep)).toHaveAttribute('aria-expanded', 'false');

  // The ⋯ menu: every action, then Esc gives focus back.
  await more(prep).focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const names = (await menu.getByRole('menuitem').allInnerTexts()).map((n) =>
    n.trim(),
  );
  expect(names).toEqual(
    expect.arrayContaining([
      'Edit',
      'Pin',
      'Make task',
      'Save as template',
      'Delete',
    ]),
  );
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(more(prep)).toBeFocused();

  // Make task asks for the title, from the first line.
  await noteAction(prep, 'Make task');
  const title = prep.getByRole('textbox', { name: 'Task title' });
  await expect(title).toHaveValue('Prep: Shield review — 2026-10-27');
  await expect(title).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(title).toBeHidden();
  await expect(toggle(prep)).toBeFocused();

  // Edit opens the composer in place; Esc drops it.
  await noteAction(prep, 'Edit');
  const editor = prep.getByRole('combobox', { name: 'Edit note' });
  await expect(editor).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();

  // Pin from the menu: it moves up with the pinned note.
  await noteAction(prep, 'Pin');
  await expect(prep).toContainText('Pinned');
  await expectSaved(page);
  expect((await stored(request)).notes['n-2']?.pinned).toBe(true);
});

test('the menu works at any width, with touch-sized targets', async ({
  page,
}) => {
  await openLive(page, '/meetings/e-1');
  const notes = page.getByRole('region', { name: 'Notes', exact: true });
  const prep = noteRow(notes, 'Bring the power budget');
  await expect(prep).toBeVisible();
  const touch = await page.evaluate(
    () => matchMedia('(pointer: coarse)').matches,
  );
  if (touch) {
    for (const target of [toggle(prep), more(prep)]) {
      const box = await target.boundingBox();
      expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(44);
    }
  }

  await more(prep).click();
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
  await expectAccessible(page);
  await page.keyboard.press('Escape');

  await openNoteRow(prep);
  await expect(prep).toContainText('Bring the power budget.');
  await expectNoSidewaysScroll(page);

  // Delete, with Undo: the row goes, and comes back.
  await noteAction(prep, 'Delete');
  await expect(prep).toHaveCount(0);
  await page
    .locator('output.toast')
    .getByRole('button', { name: 'Undo' })
    .click();
  await expect(prep).toHaveCount(1);
});

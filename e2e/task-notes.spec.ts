import type { APIRequestContext, Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  expectSaved,
  noteAction,
  openLive,
  openNoteRow,
  openNotes,
  SEED,
  test,
} from './fixtures';

interface Stored {
  tasks: Record<string, { id: string; title: string; projectId: string }>;
  notes: Record<
    string,
    {
      body: string;
      projectId: string | null;
      taskId?: string | null;
      meetingId: string | null;
    }
  >;
  activity: Record<string, { events: { text: string }[] }>;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

const TITLE = 'Insulate the hangar doors';

const row = (page: Page) =>
  page.locator('[data-task-id]').filter({ hasText: TITLE });

async function openPanel(page: Page) {
  await row(page)
    .getByRole('button', { name: TITLE, exact: true })
    .first()
    .click();
  const panel = page.getByRole('dialog', { name: 'Task' });
  await expect(panel).toBeVisible();
  return panel;
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test('running notes on a task: add, edit and delete from its panel', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-echo');
  const panel = await openPanel(page);
  const notes = panel.getByRole('region', { name: 'Notes', exact: true });
  await expect(notes).toContainText('No notes yet');

  // Esc closes the composer, not the panel.
  await notes.getByRole('button', { name: 'Add note' }).click();
  const box = panel.getByRole('combobox', { name: `New note on “${TITLE}”` });
  await expect(box).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(box).toBeHidden();
  await expect(panel).toBeVisible();

  // ⌘Enter saves the note and leaves the panel open.
  await notes.getByRole('button', { name: 'Add note' }).click();
  await expect(box).toBeFocused();
  await page.keyboard.type('Pinged legal, waiting on the redline');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(box).toBeHidden();
  await expect(panel).toBeVisible();
  // No "Updated elsewhere": the note only bumped the task.
  await expect(panel.getByText('Updated elsewhere.')).toBeHidden();

  await notes.getByRole('button', { name: 'Add note' }).click();
  await expect(box).toBeFocused();
  await page.keyboard.type('Redline is **back**');
  await notes.getByRole('button', { name: 'Save note' }).click();
  await expect(box).toBeHidden();

  // Newest first, compact rows (#273); opened, rendered.
  const items = notes.locator('li[data-note-id]');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Redline is back');
  await expect(items.nth(0).locator('strong')).toHaveCount(0);
  await openNoteRow(items.nth(0));
  await expect(items.nth(0).locator('strong')).toHaveText('back');
  await expect(items.nth(1)).toContainText('Pinged legal');

  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  // Edit in place, from the row's menu.
  await noteAction(items.nth(1), 'Edit');
  const edit = panel.getByRole('combobox', { name: 'Edit note' });
  await expect(edit).toBeFocused();
  await edit.fill('Pinged legal again');
  await panel.getByRole('button', { name: 'Save note' }).click();
  await expect(items.nth(1)).toContainText('Pinged legal again');
  await expect(items.nth(1)).toContainText('edited');

  // Delete, with Undo offered.
  await noteAction(items.nth(0), 'Delete');
  await expect(items).toHaveCount(1);
  await expect(page.getByText('Deleted the note')).toBeVisible();

  // Nothing in the panel's own fields changed: it closes without asking.
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  // Once Undo has gone, the delete is done and the row counts one.
  await expect(page.getByText('Deleted the note')).toBeHidden({
    timeout: 10_000,
  });
  await expect(row(page)).toContainText('1 note');

  await expectSaved(page);
  const data = await stored(request);
  const task = Object.values(data.tasks).find((t) => t.title === TITLE);
  if (!task) throw new Error('No task');
  const mine = Object.values(data.notes).filter((n) => n.taskId === task.id);
  expect(mine).toEqual([
    expect.objectContaining({
      body: 'Pinged legal again',
      projectId: task.projectId,
      meetingId: null,
    }),
  ]);
  expect(
    (data.activity[task.projectId]?.events ?? []).map((e) => e.text),
  ).toContain(`Added a note to "${TITLE}"`);
});

test('a task’s note shows on Notes with a link to its task', async ({
  page,
}) => {
  await openLive(page, '/projects/p-echo');
  const panel = await openPanel(page);
  await panel.getByRole('button', { name: 'Add note' }).click();
  await expect(
    panel.getByRole('combobox', { name: `New note on “${TITLE}”` }),
  ).toBeFocused();
  await page.keyboard.type('Seals ordered from Bespin');
  await panel.getByRole('button', { name: 'Save note' }).click();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expectSaved(page);

  await openNotes(page);
  const card = page
    .locator('[data-note-id]')
    .filter({ hasText: 'Seals ordered from Bespin' });
  await expect(card).toBeVisible();
  const link = card.getByRole('button', { name: `Task: ${TITLE}` });
  await expect(link).toBeVisible();
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  await link.click();
  const reopened = page.getByRole('dialog', { name: 'Task' });
  await expect(reopened).toBeVisible();
  await expect(
    reopened.getByRole('region', { name: 'Notes', exact: true }),
  ).toContainText('Seals ordered from Bespin');
  await page.keyboard.press('Escape');

  // Delete the task: the note stays, its link says so.
  await page.goto('/projects/p-echo');
  const again = await openPanel(page);
  await again.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(again).toBeHidden();
  await expectSaved(page);
  await openNotes(page);
  const kept = page
    .locator('[data-note-id]')
    .filter({ hasText: 'Seals ordered from Bespin' });
  await expect(kept).toContainText('Task deleted');
});

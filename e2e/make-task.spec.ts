import type { APIRequestContext, Page } from '@playwright/test';
import {
  expect,
  expectSaved,
  noteAction,
  noteRow,
  openLive,
  openNoteRow,
  openNotes,
  SEED,
  test,
} from './fixtures';

interface Stored {
  tasks: Record<
    string,
    {
      title: string;
      projectId: string | null;
      order: number;
      sourceNoteId?: string;
      meetingId?: string | null;
    }
  >;
  notes: Record<string, { body: string }>;
  activity: Record<string, { events: { text: string }[] }>;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

/** A note's row on Notes (#274), opened by `openNotes`. */
function card(page: Page, text: string) {
  return noteRow(page.getByRole('main'), text);
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test('select text, make a task, open it, follow the source link back', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-echo');
  // A project's notes are compact rows (#273): open it, then select.
  const prep = noteRow(page, 'Bring the power budget');
  await openNoteRow(prep);
  await prep.getByText('Bring the power budget').selectText();
  const make = prep.getByRole('button', { name: /^Make task “/ });
  await expect(make).toBeVisible();
  await make.click();

  const toast = page.locator('output.toast');
  await expect(toast).toContainText('Added “Prep: Shield review — 2026-10-27”');
  await toast.getByRole('button', { name: 'Open' }).click();
  const panel = page.getByRole('dialog');
  await expect(panel.getByRole('textbox', { name: 'Title' })).toHaveValue(
    'Prep: Shield review — 2026-10-27',
  );
  await expect(panel.getByRole('heading', { name: 'From note' })).toBeVisible();

  await expectSaved(page);
  const data = await stored(request);
  const made = Object.values(data.tasks).find((t) => t.sourceNoteId === 'n-2');
  const others = Object.values(data.tasks).filter(
    (t) => t.projectId === 'p-echo' && t !== made,
  );
  expect(made?.projectId).toBe('p-echo');
  expect(made?.order).toBe(Math.max(...others.map((t) => t.order)) + 1);
  expect(data.notes['n-2']?.body).toBe(SEED.notes['n-2'].body);
  // The note is Shield review's, so the task is its action item (#336).
  expect(made?.meetingId).toBe('e-1');
  expect(data.activity['p-echo']?.events[0]?.text).toBe(
    'Added action item "Prep: Shield review — 2026-10-27" to "Shield review"',
  );

  // Back to the note from the task's panel (a task opens in its panel
  // everywhere, #329): the row is open, focused and ringed.
  await page.goto('/all?kind=task');
  await page
    .getByRole('button', { name: 'Prep: Shield review — 2026-10-27' })
    .first()
    .click();
  await page
    .getByRole('dialog', { name: 'Task' })
    .getByRole('link', { name: 'Show the note' })
    .click();
  await expect(page).toHaveURL(/\/projects\/p-echo\?note=n-2/);
  await expect(page.getByRole('dialog')).toBeHidden();
  const back = noteRow(page, 'Bring the power budget');
  await expect(back).toBeFocused();
  await expect(back).toHaveAttribute('data-highlighted');
  await expect(
    back.getByRole('button', { name: /^Note from / }),
  ).toHaveAttribute('aria-expanded', 'true');
});

test('Esc dismisses the selection button', async ({ page }) => {
  await openNotes(page, '', ['n-3']);
  const ideas = card(page, 'Ideas for the next quarter');
  await ideas.getByText('Fewer moons').selectText();
  const make = ideas.getByRole('button', { name: 'Make task “Fewer moons”' });
  await expect(make).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(make).toBeHidden();
});

test('the footer asks for the title, starting from the first line', async ({
  page,
  request,
}) => {
  await openNotes(page, '', ['n-3']);
  const ideas = card(page, 'Ideas for the next quarter');
  await noteAction(ideas, 'Make task');
  const title = ideas.getByRole('textbox', { name: 'Task title' });
  await expect(title).toHaveValue('Ideas for the next quarter:');
  await expect(title).toBeFocused();
  await title.fill('Plan next quarter');
  await title.press('Enter');
  await expect(page.locator('output.toast')).toContainText(
    'Added “Plan next quarter”',
  );
  await expectSaved(page);
  const made = Object.values((await stored(request)).tasks).find(
    (t) => t.title === 'Plan next quarter',
  );
  expect(made).toMatchObject({ projectId: null, sourceNoteId: 'n-3' });
});

test('a deleted source note leaves the task, which says so', async ({
  page,
}) => {
  await openLive(page, '/projects/p-echo');
  // t-4 was made from the Standup note.
  await noteAction(noteRow(page, 'Standup'), 'Delete');
  await page
    .getByRole('button', { name: 'Book the tauntaun vet' })
    .first()
    .click();
  const panel = page.getByRole('dialog');
  await expect(panel.getByRole('heading', { name: 'From note' })).toBeVisible();
  // The delete goes out when its Undo ends (5 seconds), not before.
  await expect(panel.getByText('Note deleted')).toBeVisible({
    timeout: 10_000,
  });
});

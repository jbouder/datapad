import type { APIRequestContext, Page } from '@playwright/test';
import { expect, expectSaved, openLive, SEED, test } from './fixtures';

interface Stored {
  tasks: Record<
    string,
    {
      title: string;
      projectId: string | null;
      order: number;
      sourceNoteId?: string;
    }
  >;
  notes: Record<string, { body: string }>;
  activity: Record<string, { events: { text: string }[] }>;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

function card(page: Page, text: string) {
  return page.locator('article[data-note-id]').filter({ hasText: text });
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test('select text, make a task, open it, follow the source link back', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-echo');
  const prep = card(page, 'Bring the power budget');
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
  expect(data.activity['p-echo']?.events[0]?.text).toBe(
    'Added task "Prep: Shield review — 2026-10-27"',
  );

  // Back to the note from the task's page: the card is focused and ringed.
  await page.goto('/tasks');
  await page
    .getByRole('button', { name: 'Prep: Shield review — 2026-10-27' })
    .first()
    .click();
  await expect(page).toHaveURL(/\/tasks\/[^/]+$/);
  await page
    .getByRole('main')
    .getByRole('link', { name: 'Show the note' })
    .click();
  await expect(page).toHaveURL(/\/projects\/p-echo\?note=n-2/);
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(card(page, 'Bring the power budget')).toBeFocused();
  await expect(card(page, 'Bring the power budget')).toHaveAttribute(
    'data-highlighted',
  );
});

test('Esc dismisses the selection button', async ({ page }) => {
  await openLive(page, '/notes');
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
  await openLive(page, '/notes');
  const ideas = card(page, 'Ideas for the next quarter');
  await ideas.getByRole('button', { name: 'Make task from note' }).click();
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
  const standup = card(page, 'Standup');
  await standup.getByRole('button', { name: 'Delete note' }).click();
  await page
    .getByRole('button', { name: 'Book the tauntaun vet' })
    .first()
    .click();
  const panel = page.getByRole('dialog');
  await expect(panel.getByRole('heading', { name: 'From note' })).toBeVisible();
  await expect(panel.getByText('Note deleted')).toBeVisible();
});

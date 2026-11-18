import type { APIRequestContext, Locator, Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  expectSaved,
  openLive,
  SEED,
  test,
} from './fixtures';

/** Scratch (#333), desktop and phone. */

interface Stored {
  tasks: Record<
    string,
    {
      title: string;
      projectId: string | null;
      sourceNoteId?: string;
      decide?: boolean;
    }
  >;
  notes: Record<
    string,
    { body: string; projectId: string | null; createdAt: string }
  >;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

const blocks = (page: Page) =>
  page.getByRole('list', { name: 'Scratch notes' }).getByRole('article');
const block = (page: Page, text: string | RegExp) =>
  blocks(page).filter({ hasText: text });
const toast = (page: Page) => page.getByRole('status').filter({ hasText: /./ });
const writer = (page: Page) =>
  page.getByRole('combobox', { name: 'New block' });

async function addBlock(
  page: Page,
  text: string,
  shown = text.split('\n')[0] ?? text,
) {
  await writer(page).fill(text);
  await page.getByRole('button', { name: 'Add block' }).click();
  await expect(writer(page)).toHaveValue('');
  await expect(block(page, shown)).toBeVisible();
}

async function fileTo(item: Locator, project: string) {
  await item.getByRole('button', { name: 'File to…' }).click();
  const picker = item.getByRole('combobox', { name: 'File to project' });
  await expect(picker).toBeFocused();
  await picker.fill(project.slice(0, 6));
  await item
    .page()
    .getByRole('option', { name: new RegExp(`^${project}`) })
    .click();
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test('add a block, file it, and Undo moves it back', async ({
  page,
  request,
}) => {
  await openLive(page, '/scratch');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Scratch' }),
  ).toBeVisible();
  // The seed's Ideas note is the one block.
  await expect(blocks(page)).toHaveCount(1);
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  // ⌘Enter (or Ctrl+Enter) adds a block, at the top.
  await writer(page).fill('The hangar doors stick in the cold');
  await writer(page).press('ControlOrMeta+Enter');
  await expect(writer(page)).toHaveValue('');
  await expect(blocks(page)).toHaveCount(2);
  await expect(blocks(page).first()).toContainText(
    'The hangar doors stick in the cold',
  );
  await expect(blocks(page).first()).toContainText('just now');
  await expectSaved(page);
  let data = await stored(request);
  const [id, note] =
    Object.entries(data.notes).find(
      ([, n]) => n.body === 'The hangar doors stick in the cold',
    ) ?? [];
  expect(note?.projectId).toBeNull();

  // File it: it leaves at once, same id, same time.
  const item = block(page, 'The hangar doors');
  await fileTo(item, 'Echo Base');
  await expect(block(page, 'The hangar doors')).toHaveCount(0);
  await expect(toast(page)).toContainText('Filed to “Echo Base');
  await expectSaved(page);
  data = await stored(request);
  expect(data.notes[id as string]).toMatchObject({
    projectId: 'p-echo',
    createdAt: note?.createdAt,
  });

  // Undo moves it back.
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(block(page, 'The hangar doors')).toBeVisible();
  await expectSaved(page);
  data = await stored(request);
  expect(data.notes[id as string]?.projectId).toBeNull();
});

test('Make task and To decide make the right task; the block stays', async ({
  page,
  request,
}) => {
  await openLive(page, '/scratch');
  await addBlock(
    page,
    '**Order** more heaters\nThe old ones rattle',
    'Order more heaters',
  );
  const item = block(page, 'Order more heaters');

  await item.getByRole('button', { name: 'Make task' }).click();
  await expect(toast(page)).toContainText('Added “Order more heaters”');
  await item.getByRole('button', { name: 'To decide' }).click();
  await expect(toast(page)).toContainText(
    'Added “Order more heaters” to decide',
  );
  await expect(item).toBeVisible();
  await expectSaved(page);

  const data = await stored(request);
  const noteId = Object.entries(data.notes).find(([, n]) =>
    n.body.startsWith('**Order** more heaters'),
  )?.[0];
  const made = Object.values(data.tasks).filter(
    (t) => t.title === 'Order more heaters',
  );
  expect(made).toHaveLength(2);
  for (const t of made) {
    expect(t).toMatchObject({ projectId: null, sourceNoteId: noteId });
  }
  expect(made.filter((t) => t.decide === true)).toHaveLength(1);
});

test('tick a checklist, edit in place, delete and Undo', async ({
  page,
  request,
}) => {
  await openLive(page, '/scratch');
  await addBlock(page, 'Packing\n- [ ] Snow goggles\n- [ ] Thermal cape');
  const item = block(page, 'Packing');

  // Checklists tick in place.
  await item.getByRole('checkbox', { name: 'Snow goggles' }).check();
  await expectSaved(page);
  let data = await stored(request);
  expect(
    Object.values(data.notes).find((n) => n.body.startsWith('Packing'))?.body,
  ).toBe('Packing\n- [x] Snow goggles\n- [ ] Thermal cape');

  // Edit in place.
  await item.getByRole('button', { name: 'Edit' }).click();
  const editor = item.getByRole('combobox', { name: 'Edit note' });
  await editor.fill('Packing list\n- [x] Snow goggles\n- [ ] Thermal cape');
  await item.getByRole('button', { name: 'Save note' }).click();
  await expect(block(page, 'Packing list')).toContainText('edited');

  // Delete, then Undo.
  await block(page, 'Packing list')
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(block(page, 'Packing list')).toHaveCount(0);
  await expect(toast(page)).toContainText('Deleted the note');
  await expectAccessible(page);
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(block(page, 'Packing list')).toBeVisible();

  // Delete for good: it goes once the toast does.
  await block(page, 'Packing list')
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(toast(page)).toBeHidden({ timeout: 10_000 });
  await expectSaved(page);
  data = await stored(request);
  expect(
    Object.values(data.notes).some((n) => n.body.startsWith('Packing')),
  ).toBe(false);
});

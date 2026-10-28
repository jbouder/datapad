import type { APIRequestContext, Page } from '@playwright/test';
import {
  addFromTopBar,
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  expectSaved,
  openLive,
  openNotes,
  SEED,
  test,
} from './fixtures';

interface Stored {
  notes: Record<string, { body: string; projectId: string | null }>;
  templates: Record<string, { name: string; body?: string; tasks: unknown[] }>;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

function card(page: Page, text: string | RegExp) {
  return page.locator('article[data-note-id]').filter({ hasText: text });
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test('make a note template in Settings, start a note from it, then /template', async ({
  page,
  request,
}) => {
  await openLive(page, '/settings/templates');
  await expect(page.getByRole('list', { name: 'Note templates' })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'New note template' }).click();
  const panel = page.getByRole('dialog', { name: 'New note template' });
  // Both are needed.
  await panel.getByRole('button', { name: 'Add template' }).click();
  await expect(panel.getByText('Give the template a name')).toBeVisible();
  await expect(panel.getByText('Write what a note starts with')).toBeVisible();
  await panel.getByRole('textbox', { name: 'Name' }).fill('Weekly 1:1');
  await panel
    .getByRole('combobox', { name: 'Note' })
    .fill('## Wins\n- \n## Blockers\n- ');
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);
  await panel.getByRole('button', { name: 'Add template' }).click();
  await expect(panel).toBeHidden();
  await expect(
    page.getByRole('list', { name: 'Note templates' }),
  ).toContainText('Weekly 1:1');
  // Not a project template.
  await expect(page.getByText('No project templates yet.')).toBeVisible();

  // The New note panel's picker fills the composer.
  await openLive(page, '/notes?view=list');
  await addFromTopBar(page, 'Write a note');
  const note = page.getByRole('dialog', { name: 'New note' });
  const box = note.getByRole('combobox', { name: 'Note' });
  await note.getByRole('combobox', { name: 'Template' }).click();
  await page.getByRole('option', { name: 'Weekly 1:1' }).click();
  await expect(box).toHaveValue('## Wins\n- \n## Blockers\n- ');
  await box.press('ControlOrMeta+End');
  await page.keyboard.type('Hangar heaters');
  await note.getByRole('button', { name: 'Add note' }).click();
  await expect(note).toBeHidden();
  // The newest row: its note opens in place.
  await page
    .locator('[data-note-row]')
    .first()
    .locator(':scope > button')
    .click();
  await expect(card(page, 'Hangar heaters')).toBeVisible();

  // `/template` in a note's editor puts it in at the caret.
  await card(page, 'Hangar heaters')
    .getByRole('button', { name: 'Edit note' })
    .click();
  const edit = card(page, 'Hangar heaters').getByRole('combobox', {
    name: 'Edit note',
  });
  await edit.evaluate((el: HTMLTextAreaElement) =>
    el.setSelectionRange(el.value.length, el.value.length),
  );
  // Shift+Enter: a new line without continuing the list.
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('/template week');
  const menu = page.getByRole('listbox', { name: 'Commands' });
  await expect(menu.getByRole('option')).toHaveCount(1);
  await expect(menu.getByRole('option')).toContainText('Weekly 1:1');
  await page.keyboard.press('Enter');
  await expect(edit).toHaveValue(
    '## Wins\n- \n## Blockers\n- Hangar heaters\n\n## Wins\n- \n## Blockers\n- ',
  );
  await page.keyboard.press('ControlOrMeta+Enter');
  await expectSaved(page);

  const data = await stored(request);
  const bodies = Object.values(data.notes).map((n) => n.body);
  expect(bodies).toContain(
    '## Wins\n- \n## Blockers\n- Hangar heaters\n\n## Wins\n- \n## Blockers\n-',
  );
  const [template] = Object.values(data.templates);
  expect(template).toMatchObject({
    name: 'Weekly 1:1',
    body: '## Wins\n- \n## Blockers\n-',
    tasks: [],
  });
});

test('save a note as a template, mentions and all', async ({
  page,
  request,
}) => {
  await openNotes(page, '', ['n-1']);
  await card(page, 'Tauntauns fed')
    .getByRole('button', { name: 'Save as template from note' })
    .click();
  const panel = page.getByRole('dialog', { name: 'New note template' });
  await expect(panel.getByRole('textbox', { name: 'Name' })).toHaveValue(
    'Standup',
  );
  // Mentions read as names while editing.
  await expect(panel.getByRole('combobox', { name: 'Note' })).toHaveValue(
    /@Chewbacca has the hangar keys\./,
  );
  await panel.getByRole('button', { name: 'Add template' }).click();
  await expect(panel).toBeHidden();
  await expectSaved(page);

  const data = await stored(request);
  const template = Object.values(data.templates).find(
    (t) => t.name === 'Standup',
  );
  expect(template?.body).toContain('@{u-chewie} has the hangar keys.');

  // Only project templates in a new project's form.
  await openLive(page, '/projects');
  await page.getByRole('button', { name: 'Add project' }).click();
  await expect(
    page.getByRole('dialog').getByRole('combobox', {
      name: 'Start from template',
    }),
  ).toHaveCount(0);
});

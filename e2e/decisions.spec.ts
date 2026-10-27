import type { APIRequestContext } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectSaved,
  openLive,
  SEED,
  test,
} from './fixtures';

interface Stored {
  decisions: Record<
    string,
    {
      title: string;
      status: string;
      decidedAt: string;
      deciders: string[];
      rationale: string;
      projectId: string | null;
      sourceNoteId?: string;
    }
  >;
  notes: Record<string, { body: string }>;
  activity: Record<string, { events: { text: string }[] }>;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test('record a decision on a project, decide it, find it again', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-echo');
  const add = page.getByRole('textbox', { name: 'Add a decision' });
  await add.fill('Move the base to Hoth');
  await add.press('Enter');
  await expect(add).toHaveValue('');
  const list = page.getByRole('list', {
    name: 'Decisions in Echo Base relocation',
  });
  await expect(list).toContainText('Proposed');
  await expectSaved(page);
  expect((await stored(request)).activity['p-echo']?.events[0]?.text).toBe(
    'Proposed "Move the base to Hoth"',
  );

  await list.getByRole('button', { name: 'Move the base to Hoth' }).click();
  const panel = page.getByRole('dialog', { name: 'Decision' });
  await panel
    .getByRole('group', { name: 'Status' })
    .getByText('Decided')
    .click();
  await panel
    .getByRole('group', { name: 'Decided by' })
    .getByText('Leia Organa')
    .click();
  await panel
    .getByRole('combobox', { name: 'Why' })
    .fill('Further from the core. Ask @Leia Organa');
  await expectAccessible(page);
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel).toBeHidden();
  await expect(list).toContainText('Decided');
  await expectSaved(page);

  const data = await stored(request);
  const saved = Object.values(data.decisions)[0];
  expect(saved).toMatchObject({
    title: 'Move the base to Hoth',
    status: 'decided',
    deciders: ['u-leia'],
    projectId: 'p-echo',
  });
  expect(saved?.decidedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(saved?.rationale).toContain('@{u-leia}');
  expect(data.activity['p-echo']?.events[0]?.text).toBe(
    'Decided "Move the base to Hoth"',
  );

  // The cross-project view, its filters, and ⌘K.
  await openLive(page, '/decisions');
  await expect(
    page.getByRole('list', { name: 'Decisions in Echo Base relocation' }),
  ).toContainText('Move the base to Hoth');
  await expectAccessible(page);
  await page
    .getByRole('group', { name: 'Status' })
    .getByText('Proposed')
    .click();
  await expect(page.getByText('None match these filters.')).toBeVisible();

  await page.getByRole('button', { name: /^Search/ }).click();
  const palette = page.getByRole('dialog', { name: 'Search' });
  await palette.getByRole('combobox').fill('hoth');
  await expect(palette.getByRole('group', { name: 'Decisions' })).toContainText(
    'Move the base to Hoth',
  );
  await palette
    .getByRole('group', { name: 'Decisions' })
    .getByRole('option', { name: /Move the base to Hoth/ })
    .click();
  await expect(page.getByRole('dialog', { name: 'Decision' })).toBeVisible();

  // Leia's page lists it.
  await openLive(page, '/settings/people/u-leia');
  await expect(
    page.getByRole('list', { name: 'Decisions Leia Organa took part in' }),
  ).toContainText('Move the base to Hoth');
});

test('/decision in a note records the line, linked to the note', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-falcon');
  const box = page.getByRole('combobox', { name: 'New note' });
  await box.fill('Review notes\nUse the spare motivator /decision');
  await expect(page.getByRole('option', { name: /^Decision/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('Proposed “Use the spare motivator”'),
  ).toBeVisible();
  await expect(box).toHaveValue(
    'Review notes\n**Decision:** Use the spare motivator',
  );
  await box.press('ControlOrMeta+Enter');
  await expectSaved(page);

  const data = await stored(request);
  const made = Object.values(data.decisions)[0];
  expect(made).toMatchObject({
    title: 'Use the spare motivator',
    status: 'proposed',
    projectId: 'p-falcon',
  });
  expect(data.notes[made?.sourceNoteId ?? '']?.body).toContain(
    '**Decision:** Use the spare motivator',
  );

  await page
    .getByRole('list', { name: 'Decisions in Falcon hyperdrive refit' })
    .getByRole('button', { name: 'Use the spare motivator' })
    .click();
  await expect(
    page
      .getByRole('dialog', { name: 'Decision' })
      .getByRole('link', { name: 'a note' }),
  ).toBeVisible();
});

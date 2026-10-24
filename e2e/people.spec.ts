import type { APIRequestContext, Page } from '@playwright/test';
import { expect, expectSaved, openLive, SEED, test } from './fixtures';

interface Stored {
  tasks: Record<string, { title: string; assignee: string }>;
  people: Record<string, { name: string; me: boolean }>;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

const people = (page: Page) => page.getByRole('list', { name: 'People' });
const detail = (page: Page) => page.locator('[data-person-id]');

async function addPerson(page: Page, name: string, me = false) {
  await page.getByRole('button', { name: 'Add person' }).click();
  const panel = page.getByRole('dialog', { name: 'Add person' });
  await panel.getByRole('textbox', { name: 'Name' }).fill(name);
  if (me) await panel.getByRole('checkbox', { name: 'This is me' }).click();
  await panel.getByRole('button', { name: 'Add person' }).click();
  await expect(panel).toBeHidden();
}

test('add, assign, mention, the detail pane, This is me, remove', async ({
  page,
  request,
}) => {
  await openLive(page, '/settings/people');
  await addPerson(page, 'Leia Organa', true);
  // Adding someone selects them.
  await expect(page).toHaveURL(/\/settings\/people\/[^/]+$/);
  await expect(detail(page).getByRole('heading', { level: 3 })).toHaveText(
    /Leia Organa\s*you/,
  );
  await addPerson(page, 'Han Solo');

  // A task assigned to Han, and a note that mentions him.
  await page.goto('/');
  const add = page.getByRole('textbox', { name: 'Add a task' });
  await add.fill('Fix the compressor');
  await add.press('Enter');
  await page.getByRole('button', { name: 'Fix the compressor' }).click();
  const panel = page.getByRole('dialog', { name: 'Task' });
  const who = panel.getByRole('combobox', { name: 'Assignee' });
  await who.click();
  await who.fill('han');
  await page.getByRole('option', { name: /^Han Solo/ }).click();
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel).toBeHidden();

  await page.goto('/notes');
  await page
    .getByRole('combobox', { name: 'New note' })
    .fill('Ask @Han Solo about the **compressor**');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expectSaved(page);

  // Han's detail: no projects, the task, the mention under General.
  await page.goto('/settings/people');
  await people(page)
    .getByRole('link', { name: /Han Solo/ })
    .click();
  await expect(page).toHaveURL(/\/settings\/people\/[^/]+$/);
  const han = detail(page);
  await expect(han).toContainText('Not on any project.');
  await expect(
    han.getByRole('list', { name: 'Open tasks assigned to Han Solo' }),
  ).toContainText('Fix the compressor');
  const mention = han
    .getByRole('region', { name: 'Mentions in General' })
    .getByRole('link');
  await expect(mention).toHaveText(/Ask @Han Solo about the compressor/);
  const hanUrl = page.url();

  // The mention leads to the note on the Notes page.
  await mention.click();
  await expect(page).toHaveURL(/\/notes\?note=/);
  await expect(page.locator('[data-highlighted]')).toContainText(
    'about the compressor',
  );

  // This is me moves to Han, and Mine follows at once.
  await page.goto(hanUrl);
  await page.getByRole('button', { name: 'Edit Han Solo' }).click();
  const form = page.getByRole('dialog', { name: 'Edit Han Solo' });
  await form.getByRole('checkbox', { name: 'This is me' }).click();
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toBeHidden();
  await expect(
    people(page).getByRole('listitem').filter({ hasText: 'Leia' }),
  ).not.toContainText('you');
  await page.goto('/?who=mine');
  await expect(page.getByRole('region', { name: 'Open tasks' })).toContainText(
    'Fix the compressor',
  );

  // Remove Han: the note reads @unknown, the task is unassigned.
  await page.goto(hanUrl);
  await page.getByRole('button', { name: 'Edit Han Solo' }).click();
  await form.getByRole('button', { name: 'Remove' }).click();
  await expect(form.getByRole('alertdialog')).toContainText(
    'Remove Han Solo? Mentions of them show as @unknown and 1 task becomes unassigned.',
  );
  await form
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Remove' })
    .click();
  await expect(page).toHaveURL(/\/settings\/people$/);
  await expect(people(page).getByRole('listitem')).toHaveText([/Leia Organa/]);
  await page.goto('/notes');
  await expect(page.getByText('Ask @unknown about the')).toBeVisible();
  await expectSaved(page);
  const data = await stored(request);
  expect(
    Object.values(data.tasks).find((t) => t.title === 'Fix the compressor')
      ?.assignee,
  ).toBe('');
});

test('an old /people/:id link and the seeded detail pane', async ({
  page,
  request,
}) => {
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/people/u-chewie');
  await expect(page).toHaveURL(/\/settings\/people\/u-chewie$/);
  const chewie = detail(page);
  await expect(chewie.getByRole('list', { name: 'Projects' })).toHaveText(
    /Echo Base relocation\s*Falcon hyperdrive refit/,
  );
  await expect(
    people(page).getByRole('link', { name: /Chewbacca/ }),
  ).toHaveAttribute('aria-current', 'true');
});

test('Cards: counts match the detail, and a card opens the person', async ({
  page,
  request,
}) => {
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/settings/people');
  await page.locator('label', { hasText: 'Cards' }).click();
  await expect(page).toHaveURL(/view=cards/);
  const cards = page.getByRole('list', { name: 'People' });
  const han = cards.getByRole('link', { name: /Han Solo/ });
  await expect(han).toContainText('2 projects · 1 open task');
  await han.click();
  await expect(page).toHaveURL(/\/settings\/people\/u-han$/);
  const pane = detail(page);
  await expect(pane.getByRole('list', { name: 'Projects' })).toHaveText(
    /Echo Base relocation\s*Falcon hyperdrive refit/,
  );
  await expect(
    pane.getByRole('list', { name: 'Open tasks assigned to Han Solo' }),
  ).toContainText('Find a replacement motivator');
  // The layout is remembered after navigating.
  await expect(page.getByRole('radio', { name: 'Cards' })).toBeChecked();
});

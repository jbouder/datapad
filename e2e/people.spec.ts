import type { APIRequestContext, Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  expectSaved,
  openLive,
  SEED,
  test,
} from './fixtures';

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
  await expect(detail(page).getByRole('heading', { level: 2 })).toHaveText(
    /Leia Organa\s*you/,
  );
  await addPerson(page, 'Han Solo');

  // A task assigned to Han, and a note that mentions him.
  await openLive(page, '/');
  await page.locator('body').press('n');
  const panel = page.getByRole('dialog', { name: 'New task' });
  const title = panel.getByRole('textbox', { name: 'Title' });
  await title.fill('Fix the compressor');
  const who = panel.getByRole('combobox', { name: 'Assignee' });
  await who.click();
  await who.fill('han');
  await page.getByRole('option', { name: /^Han Solo/ }).click();
  await title.press('Enter');
  await expect(panel).toBeHidden();

  await page.goto('/notes');
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Add note' })
    .click();
  const write = page.getByRole('dialog', { name: 'New note' });
  await write
    .getByRole('combobox', { name: 'Note' })
    .fill('Ask @Han Solo about the **compressor**');
  await write.getByRole('button', { name: 'Add note' }).click();
  await expect(write).toBeHidden();
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
  await page.goto('/tasks?who=mine');
  await expect(page.getByRole('main')).toContainText('Fix the compressor');

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
  await page.goto('/notes?view=list');
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
  await expect(page).toHaveTitle('People · Settings · Datapad');
  await expect(
    page
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('link', { name: 'People' }),
  ).toHaveAttribute('aria-current', 'page');
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

test('Find narrows People by name or role, and Clear filters brings them back', async ({
  page,
  request,
}) => {
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/settings/people');
  const links = people(page).getByRole('link');
  await expect(links).toHaveCount(4);
  const find = page.getByRole('searchbox', { name: 'Find' });
  await find.fill('captain');
  await expect(page).toHaveURL(/q=captain/);
  await expect(links).toHaveCount(1);
  await expect(links).toContainText('Han Solo');
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  // Nothing matches: the filtered empty state, then everyone again.
  await find.fill('wookiee captain');
  await expect(page.getByText('None match these filters.')).toBeVisible();
  await expectAccessible(page);
  await page
    .getByRole('button', { name: 'Clear filters' })
    .filter({ visible: true })
    .first()
    .click();
  await expect(find).toHaveValue('');
  await expect(page).not.toHaveURL(/q=/);
  await expect(links).toHaveCount(4);

  // Picking someone keeps Find.
  await find.fill('captain');
  await expect(links).toHaveCount(1);
  await links.first().click();
  await expect(page).toHaveURL(/\/settings\/people\/u-han\?q=captain$/);
  await expect(find).toHaveValue('captain');
  await expect(detail(page)).toBeVisible();
});

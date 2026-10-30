import type { Page } from '@playwright/test';
import { formatDay } from '../shared/dates';
import {
  chooseFilter,
  closeFilters,
  expect,
  expectAccessible,
  isMobile,
  moreAction,
  openFilters,
  openLive,
  SEED,
  seedDay,
  test,
  today,
} from './fixtures';

const cards = (page: Page) =>
  page.getByRole('list', { name: 'Projects' }).getByRole('link');

async function newProject(
  page: Page,
  name: string,
  org: string,
  priority: 'Low' | 'Medium' | 'High',
) {
  await page.getByRole('button', { name: 'Add project' }).click();
  const panel = page.getByRole('dialog');
  await panel.getByRole('textbox', { name: 'Name' }).fill(name);
  const orgBox = panel.getByRole('combobox', { name: 'Org' });
  await orgBox.click();
  await orgBox.fill(org);
  await expect(
    page.getByRole('option', { name: new RegExp(org) }).first(),
  ).toBeVisible();
  await orgBox.press('Enter');
  await panel
    .locator('label', {
      hasText: new RegExp(`^${priority === 'Medium' ? 'Med' : priority}$`),
    })
    .click();
  await panel.getByRole('button', { name: 'Create project' }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await page.goto('/projects');
}

test('create two, filter by org, sort by priority, archive one', async ({
  page,
}) => {
  await openLive(page, '/projects');
  await expect(page.getByText('No projects yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Add project' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel' })
    .click();

  await newProject(page, 'Alderaan relief', 'Rebel Alliance', 'Low');
  await newProject(page, 'Bespin audit', 'Cloud City', 'High');
  // Default: Active, recently updated first.
  await expect(cards(page)).toHaveText([/Bespin audit/, /Alderaan relief/]);

  await chooseFilter(page, 'Org', 'Rebel Alliance');
  await expect(page).toHaveURL(/org=Rebel\+Alliance/);
  await expect(cards(page)).toHaveText([/Alderaan relief/]);

  await chooseFilter(page, 'Org', 'All orgs');
  await chooseFilter(page, 'Sort', 'Name');
  await expect(page).toHaveURL(/sort=name/);
  await expect(cards(page)).toHaveText([/Alderaan relief/, /Bespin audit/]);
  await chooseFilter(page, 'Sort', 'Priority');
  await expect(cards(page)).toHaveText([/Bespin audit/, /Alderaan relief/]);

  // Back restores the previous filters.
  await page.goBack();
  await expect(page).toHaveURL(/sort=name/);
  await expect(cards(page)).toHaveText([/Alderaan relief/, /Bespin audit/]);

  // Archive one from its page; it leaves Projects and shows in Archived.
  await cards(page).filter({ hasText: 'Bespin audit' }).click();
  await moreAction(page, 'Archive');
  await page.goto('/projects');
  await expect(cards(page)).toHaveText([/Alderaan relief/]);
  await page.goto('/archive');
  await expect(
    page.getByRole('list', { name: 'Archived projects' }).getByRole('link'),
  ).toHaveText([/Bespin audit/]);
});

test('cards carry org, status, state, counts, target, next marker and members', async ({
  page,
  request,
}) => {
  await request.post('/api/import', {
    data: {
      ...SEED,
      projects: {
        ...SEED.projects,
        'p-echo': {
          ...SEED.projects['p-echo'],
          members: ['u-leia', 'u-han', 'u-chewie', 'u-mon', 'u-extra'],
        },
      },
      people: {
        ...SEED.people,
        'u-extra': {
          id: 'u-extra',
          name: 'Wedge Antilles',
          role: '',
          me: false,
        },
      },
    },
  });
  await openLive(page, '/projects');
  const echo = cards(page).filter({ hasText: 'Echo Base relocation' });
  await expect(echo).toContainText('Rebel Alliance');
  await expect(echo).toContainText('Active');
  // The retired current state line is not shown.
  await expect(echo).not.toContainText('Shield generator parts arrive Friday');
  await expect(echo).toContainText('3 open tasks');
  await expect(echo).toContainText(
    `Target ${formatDay(seedDay('2026-11-14'), today())}`,
  );
  await expect(echo).toContainText('Base operational');
  // Four initials, then +1.
  await expect(echo).toContainText('+1 more');
  await expect(echo).toHaveAttribute('href', '/projects/p-echo');
});

test('empty filters say so and clear, keeping the sort', async ({
  page,
  request,
}) => {
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/projects?status=done&sort=name');
  await expect(page.getByText('None match these filters.')).toBeVisible();
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Clear filters' })
    .first()
    .click();
  // Clear filters leaves the sort alone (#270).
  await expect(page).toHaveURL(/\/projects\?sort=name$/);
  await expect(cards(page)).toHaveText([/Echo Base relocation/]);
});

test('Find matches name, org, tags and description', async ({
  page,
  request,
}) => {
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/projects?status=all');
  await expect(cards(page)).toHaveCount(2);
  const find = page.getByRole('searchbox', { name: 'Find' });
  await find.fill('corellian');
  await expect(page).toHaveURL(/q=corellian/);
  await expect(cards(page)).toHaveText([/Falcon hyperdrive refit/]);
  // A tag, then a word from the description.
  await find.fill('vendor');
  await expect(cards(page)).toHaveText([/Falcon hyperdrive refit/]);
  await find.fill('tauntaun');
  await expect(cards(page)).toHaveText([/Echo Base relocation/]);
  await find.fill('nothing like it');
  await expect(page.getByText('None match these filters.')).toBeVisible();
  await expectAccessible(page);
  // Esc clears Find; the filters stay.
  await find.press('Escape');
  await expect(find).toHaveValue('');
  await expect(page).toHaveURL(/\/projects\?status=all$/);
  await expect(cards(page)).toHaveCount(2);

  // On phones the filters are in the sheet, counted on its button.
  if (isMobile(page)) {
    await expect(
      page.getByRole('button', { name: 'Filters (1)' }),
    ).toBeVisible();
    const sheet = await openFilters(page);
    await expect(sheet.getByRole('group', { name: 'Status' })).toBeVisible();
    await expect(sheet.getByRole('combobox', { name: 'Sort' })).toBeVisible();
    await expectAccessible(page);
    await closeFilters(page);
  }
});

test('Archived says so when empty', async ({ page }) => {
  await openLive(page, '/archive');
  await expect(page.getByText('Nothing archived.')).toBeVisible();
});

test('Archived has Find and Sort, and the sort is saved', async ({
  page,
  request,
}) => {
  await request.post('/api/import', {
    data: {
      ...SEED,
      projects: {
        ...SEED.projects,
        'p-alderaan': {
          ...SEED.projects['p-yavin'],
          id: 'p-alderaan',
          name: 'Alderaan memorial',
          org: 'Royal House',
          tags: ['memorial'],
          desc: '',
        },
      },
    },
  });
  await openLive(page, '/archive');
  const archived = page
    .getByRole('list', { name: 'Archived projects' })
    .getByRole('link');
  await expect(archived).toHaveCount(2);

  await chooseFilter(page, 'Sort', 'Name');
  await expect(page).toHaveURL(/sort=name/);
  await expect(archived).toHaveText([
    /Alderaan memorial/,
    /Yavin IV retrospective/,
  ]);

  const find = page.getByRole('searchbox', { name: 'Find' });
  await find.fill('yavin');
  await expect(page).toHaveURL(/q=yavin/);
  await expect(archived).toHaveText([/Yavin IV retrospective/]);
  await find.fill('hoth');
  await expect(page.getByText('None match these filters.')).toBeVisible();
  await expectAccessible(page);
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Clear filters' })
    .first()
    .click();
  await expect(find).toHaveValue('');
  await expect(archived).toHaveCount(2);

  // The sort is saved for the page; Find is not.
  await expect
    .poll(
      async () =>
        (await (await request.get('/api/export.json')).json()).settings?.user
          ?.pages?.archive ?? null,
    )
    .toEqual({ sort: 'name' });
  await openLive(page, '/archive');
  await expect(archived).toHaveText([
    /Alderaan memorial/,
    /Yavin IV retrospective/,
  ]);
});

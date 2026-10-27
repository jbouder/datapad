import type { Page } from '@playwright/test';
import { formatDay } from '../shared/dates';
import { expect, openLive, SEED, seedDay, test, today } from './fixtures';

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

async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
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

  await choose(page, 'Org', 'Rebel Alliance');
  await expect(page).toHaveURL(/org=Rebel\+Alliance/);
  await expect(cards(page)).toHaveText([/Alderaan relief/]);

  await choose(page, 'Org', 'All orgs');
  await choose(page, 'Sort by', 'Name');
  await expect(page).toHaveURL(/sort=name/);
  await expect(cards(page)).toHaveText([/Alderaan relief/, /Bespin audit/]);
  await choose(page, 'Sort by', 'Priority');
  await expect(cards(page)).toHaveText([/Bespin audit/, /Alderaan relief/]);

  // Back restores the previous filters.
  await page.goBack();
  await expect(page).toHaveURL(/sort=name/);
  await expect(cards(page)).toHaveText([/Alderaan relief/, /Bespin audit/]);

  // Archive one from its page; it leaves Projects and shows in Archived.
  await cards(page).filter({ hasText: 'Bespin audit' }).click();
  await page.getByRole('button', { name: 'Archive' }).click();
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

test('empty filters say so and clear', async ({ page, request }) => {
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/projects?status=done');
  await expect(page.getByText('None match these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(cards(page)).toHaveText([/Echo Base relocation/]);
});

test('Archived says so when empty', async ({ page }) => {
  await openLive(page, '/archive');
  await expect(page.getByText('Nothing archived.')).toBeVisible();
});

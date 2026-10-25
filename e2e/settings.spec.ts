import type { Page } from '@playwright/test';
import {
  expect,
  expectSaved,
  isMobile,
  openLive,
  openPreferences,
  SEED,
  test,
} from './fixtures';

const settingsNav = (page: Page) =>
  page.getByRole('navigation', { name: 'Settings' });

test('the account menu leads to Settings; People and Orgs are rail-only', async ({
  page,
  email,
}) => {
  await openLive(page, '/');
  await openPreferences(page);
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  // The spaces and New space…, Motion and Theme, then Settings, then Sign
  // out. Phones, with no People or Orgs in the tab bar, get them here.
  await expect(
    page
      .getByRole('menu')
      .getByRole('menuitem')
      .or(page.getByRole('menu').getByRole('menuitemcheckbox'))
      .or(page.getByRole('menu').getByRole('menuitemradio')),
  ).toHaveText([
    'Main',
    'New space…',
    'Motion',
    'System',
    'Light',
    'Dark',
    ...(isMobile(page) ? ['People', 'Orgs'] : []),
    'Settings',
    'Sign out',
  ]);
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page).toHaveTitle('Appearance · Settings · Datapad');
  await expect(
    settingsNav(page).getByRole('link', { name: 'Appearance' }),
  ).toHaveAttribute('aria-current', 'page');

  await expect(
    settingsNav(page).getByRole('link', { name: /People|Orgs/ }),
  ).toHaveCount(0);
  const sections = page.getByRole('navigation', { name: 'Sections' });
  for (const name of ['People', 'Orgs']) {
    if (isMobile(page)) {
      await expect(sections.getByRole('link', { name })).toHaveCount(0);
    } else {
      await expect(sections.getByRole('link', { name })).toBeVisible();
    }
  }
  // No signed-in email in the rail; the account menu shows it.
  await expect(page.getByRole('complementary').getByText(email)).toHaveCount(0);
  // No Import / Export in the rail any more.
  await expect(
    page
      .getByRole('complementary')
      .getByRole('button', { name: /Import|Export/ }),
  ).toHaveCount(0);

  // The old Settings addresses land on the new pages.
  await page.goto('/settings/people');
  await expect(page).toHaveURL(/\/people$/);
  await expect(page).not.toHaveURL(/settings/);
  await expect(page).toHaveTitle('People · Datapad');
});

test.describe('Appearance', () => {
  test.use({ reducedMotion: 'no-preference' });
  test('theme and motion', async ({ page }) => {
    await openLive(page, '/settings');
    await page.locator('label', { hasText: /^Dark$/ }).click();
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await page.locator('label', { hasText: /^Light$/ }).click();
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);

    const motion = page.getByRole('switch', { name: /Motion/ });
    await expect(motion).toBeChecked();
    await motion.click();
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'off');
  });
});

test('People: add, mark yourself, edit and remove', async ({
  page,
  request,
}) => {
  await openLive(page, '/people');
  await expect(page.getByText('No people yet.')).toBeVisible();
  const panel = page.getByRole('dialog');
  for (const [who, role] of [
    ['Leia Organa', 'General'],
    ['Han Solo', ''],
  ]) {
    await page.getByRole('button', { name: 'Add person' }).click();
    await panel.getByRole('textbox', { name: 'Name' }).fill(who);
    await panel.getByRole('textbox', { name: 'Role' }).fill(role);
    await panel.getByRole('button', { name: 'Add person' }).click();
    await expect(panel).toBeHidden();
  }
  const list = page.getByRole('list', { name: 'People' });
  await expect(list.getByRole('listitem')).toHaveText([
    /Han Solo/,
    /Leia Organa\s*General/,
  ]);

  await list.getByRole('link', { name: /Leia Organa/ }).click();
  await page.getByRole('button', { name: 'Edit Leia Organa' }).click();
  await panel.getByRole('checkbox', { name: 'This is me' }).click();
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel).toBeHidden();
  await expect(list.getByRole('listitem').last()).toContainText('you');

  await list.getByRole('link', { name: /Han Solo/ }).click();
  await page.getByRole('button', { name: 'Edit Han Solo' }).click();
  await panel.getByRole('button', { name: 'Remove' }).click();
  await expect(panel.getByRole('alertdialog')).toContainText(
    'Remove Han Solo? Mentions of them show as @unknown.',
  );
  await panel
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Remove' })
    .click();
  await expect(list.getByRole('listitem')).toHaveText([/Leia Organa/]);

  await expectSaved(page);

  const data = await (await request.get('/api/export.json')).json();
  expect(Object.values(data.people)).toEqual([
    expect.objectContaining({ name: 'Leia Organa', role: 'General', me: true }),
  ]);
});

test('Orgs: a default org that new projects start in', async ({
  page,
  request,
}) => {
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/orgs');
  const picker = page.getByRole('combobox', { name: 'Default org' });
  await expect(picker).toHaveValue('OpenTeams Internal');
  // Plain text until organized; then each is a record with a count.
  await page.getByRole('button', { name: 'Organize orgs' }).click();
  const list = page.getByRole('list', { name: 'Orgs' });
  await expect(list).toContainText('OpenTeams Internal');
  await expect(list).toContainText('default');
  await expect(
    list.getByRole('listitem').filter({ hasText: 'Rebel Alliance' }),
  ).toContainText('2 projects');

  // New projects start in it.
  await page.goto('/projects');
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(
    page.getByRole('dialog').getByRole('combobox', { name: 'Org' }),
  ).toHaveValue('OpenTeams Internal');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel' })
    .click();

  // Change it; it is stored with your data, not just in this browser.
  await page.goto('/orgs');
  await picker.click();
  await picker.fill('Rebel');
  await page.getByRole('option', { name: 'Rebel Alliance' }).click();
  await expect(
    page.getByText('New projects start in Rebel Alliance'),
  ).toBeVisible();
  await expectSaved(page);

  const data = await (await request.get('/api/export.json')).json();
  expect(data.settings).toEqual({ user: { defaultOrg: 'Rebel Alliance' } });
});

test('Data and Account', async ({ page, request, email }) => {
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/settings/data');
  await expect(
    page.getByText(
      'You have 3 projects, 7 tasks, 4 notes, 4 events, 4 people.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import…' })).toBeVisible();

  await settingsNav(page).getByRole('link', { name: 'Account' }).click();
  await expect(page).toHaveURL(/\/settings\/account$/);
  await expect(page.getByRole('main').getByText(email)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign out' })).toHaveAttribute(
    'href',
    '/cdn-cgi/access/logout',
  );
});

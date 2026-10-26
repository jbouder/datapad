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
  orgs: Record<
    string,
    { id: string; name: string; kind: string; contacts: string[] }
  >;
  projects: Record<string, { org: string; orgId?: string | null }>;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

test('import offers to organize; orgs become records with a page each', async ({
  page,
  request,
}) => {
  await openLive(page, '/settings/data');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import…' }).click();
  await (await chooser).setFiles({
    name: 'ledger.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(SEED)),
  });
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Import' })
    .click();
  await page.getByRole('button', { name: 'Organize orgs' }).click();
  await expect(page).toHaveURL(/\/settings\/orgs$/);

  const callout = page.getByRole('status').filter({ hasText: 'plain text' });
  await expect(callout).toContainText('3 projects name an org as plain text');
  await callout.getByRole('button', { name: 'Organize orgs' }).click();
  await expect(callout).toBeHidden();
  // One org per distinct name in the projects, and nothing else: a space
  // starts with no default org to materialize.
  const list = page.getByRole('list', { name: 'Orgs' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list).toContainText('Rebel Alliance');
  await expect(list).toContainText('Corellian Engineering');
  await expectAccessible(page);
  await expectSaved(page);

  const data = await stored(request);
  const rebels = Object.values(data.orgs).find(
    (o) => o.name === 'Rebel Alliance',
  );
  expect(data.projects['p-echo']?.orgId).toBe(rebels?.id);
  expect(data.projects['p-yavin']?.orgId).toBe(rebels?.id);
  expect(
    Object.values(data.orgs).find((o) => o.name === 'Corellian Engineering')
      ?.kind,
  ).toBe('client');

  // The org's page: projects, then add a contact and rename it.
  await list.getByRole('link', { name: 'Rebel Alliance' }).click();
  await expect(page).toHaveURL(/\/settings\/orgs\/[^/]+$/);
  await expect(
    page.getByRole('list', { name: 'Projects of Rebel Alliance' }),
  ).toContainText('Echo Base relocation');
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Edit' }).click();
  const panel = page.getByRole('dialog', { name: 'Org' });
  await panel.getByRole('textbox', { name: 'Name' }).fill('The Alliance');
  await panel
    .getByRole('group', { name: 'Contacts' })
    .getByText('Mon Mothma')
    .click();
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel).toBeHidden();
  await expect(
    page.getByRole('heading', { name: 'The Alliance' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /Mon Mothma/ })).toBeVisible();
  await expectSaved(page);
  // Renamed on its projects too.
  expect((await stored(request)).projects['p-echo']?.org).toBe('The Alliance');

  // Deleting it keeps the projects' text.
  await page.getByRole('button', { name: 'Delete' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete' })
    .click();
  await expectSaved(page);
  const after = await stored(request);
  expect(after.projects['p-echo']).toMatchObject({ org: 'The Alliance' });
  expect(after.projects['p-echo']?.orgId).toBeUndefined();
});

test('a new org from the project form becomes a record and is linked', async ({
  page,
  request,
}) => {
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/projects/p-falcon');
  await page.getByRole('button', { name: 'Edit' }).click();
  const panel = page.getByRole('dialog');
  const org = panel.getByRole('combobox', { name: 'Org' });
  await org.click();
  await org.fill('Mon Cala Shipyards');
  await page.getByRole('option', { name: 'Add “Mon Cala Shipyards”' }).click();
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel).toBeHidden();
  await expectSaved(page);
  const data = await stored(request);
  const made = Object.values(data.orgs).find(
    (o) => o.name === 'Mon Cala Shipyards',
  );
  expect(made).toBeDefined();
  expect(data.projects['p-falcon']).toMatchObject({
    org: 'Mon Cala Shipyards',
    orgId: made?.id,
  });

  // The old /orgs address and ⌘K get there.
  await openLive(page, '/orgs');
  await expect(page).toHaveURL(/\/settings\/orgs$/);
  await expect(page).toHaveTitle('Orgs · Settings · Datapad');
  await page.getByRole('button', { name: /^Search/ }).click();
  const palette = page.getByRole('dialog', { name: 'Search' });
  await palette.getByRole('combobox').fill('mon cala');
  await palette
    .getByRole('group', { name: 'Orgs' })
    .getByRole('option')
    .first()
    .click();
  await expect(page).toHaveURL(/\/settings\/orgs\/[^/]+$/);
  await expect(
    page.getByRole('heading', { name: 'Mon Cala Shipyards' }),
  ).toBeVisible();
});

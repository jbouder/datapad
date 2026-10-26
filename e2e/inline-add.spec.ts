import type { APIRequestContext, Page } from '@playwright/test';
import { expect, expectSaved, openLive, SEED, test } from './fixtures';

/** Adding a person or an org from inside the form that needs one (#160). */

interface Stored {
  people: Record<string, { id: string; name: string; role: string }>;
  orgs: Record<string, { id: string; name: string; kind: string }>;
  projects: Record<
    string,
    { org: string; orgId?: string | null; members: string[] }
  >;
  meetings: Record<string, { title: string; attendees: string[] }>;
  tasks: Record<string, { title: string; assignee: string }>;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

const named = (data: Stored, name: string) =>
  Object.values(data.people).filter((p) => p.name === name);

async function editProject(page: Page) {
  await openLive(page, '/projects/p-falcon');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const panel = page.getByRole('dialog');
  await expect(panel).toBeVisible();
  return panel;
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test('the Org field adds an org first, and a known name is never doubled', async ({
  page,
  request,
}) => {
  const panel = await editProject(page);
  const org = panel.getByRole('combobox', { name: 'Org' });
  await org.click();
  await org.fill('Mon Cala Shipyards');
  const options = page.getByRole('option');
  await expect(options.first()).toHaveText(
    'Add “Mon Cala Shipyards” as an org',
  );
  // Highlighted first, so Enter takes it.
  await org.press('Enter');
  await expect(org).toHaveValue('Mon Cala Shipyards');
  // Made at once, before Save.
  await expect
    .poll(async () =>
      Object.values((await stored(request)).orgs).map((o) => o.name),
    )
    .toContain('Mon Cala Shipyards');
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel).toBeHidden();
  await expectSaved(page);
  const data = await stored(request);
  const made = Object.values(data.orgs).find(
    (o) => o.name === 'Mon Cala Shipyards',
  );
  expect(made?.kind).toBe('client');
  expect(data.projects['p-falcon']).toMatchObject({
    org: 'Mon Cala Shipyards',
    orgId: made?.id,
  });

  // The same name in another case is that org, not a new one.
  await editProject(page);
  await org.click();
  await org.fill('mon cala shipyards');
  await expect(page.getByRole('option', { name: /as an org/ })).toHaveCount(0);
  await expect(
    page.getByRole('option', { name: 'Mon Cala Shipyards' }),
  ).toBeVisible();

  // Settings → Orgs lists it.
  await openLive(page, '/orgs');
  await expect(page.getByRole('list', { name: 'Orgs' })).toContainText(
    'Mon Cala Shipyards',
  );
  expect(
    Object.values((await stored(request)).orgs).filter((o) =>
      /mon cala/i.test(o.name),
    ),
  ).toHaveLength(1);
});

test('project members: add several in a row, a known name is picked, Escape cancels', async ({
  page,
  request,
}) => {
  const panel = await editProject(page);
  const members = panel.getByRole('group', { name: 'Team members' });
  await members.getByRole('button', { name: 'Add a person' }).click();
  const name = members.getByRole('textbox', { name: 'New person’s name' });
  await expect(name).toBeFocused();

  await name.fill('Wedge Antilles');
  await name.press('Enter');
  await expect(
    members.getByRole('checkbox', { name: 'Wedge Antilles' }),
  ).toBeChecked();
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('');
  await name.fill('Biggs Darklighter');
  await name.press('Enter');
  await expect(
    members.getByRole('checkbox', { name: 'Biggs Darklighter' }),
  ).toBeChecked();
  // An existing name, in another case, checks that person.
  await name.fill('  mon mothma ');
  await name.press('Enter');
  await expect(
    members.getByRole('checkbox', { name: 'Mon Mothma' }),
  ).toBeChecked();

  // Escape closes the field, not the panel.
  await name.press('Escape');
  await expect(name).toBeHidden();
  await expect(panel).toBeVisible();
  await expect(
    members.getByRole('button', { name: 'Add a person' }),
  ).toBeFocused();

  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel).toBeHidden();
  await expectSaved(page);
  const data = await stored(request);
  expect(named(data, 'Mon Mothma')).toHaveLength(1);
  const wedge = named(data, 'Wedge Antilles');
  expect(wedge).toHaveLength(1);
  expect(wedge[0].role).toBe('');
  const ids = data.projects['p-falcon'].members;
  expect(ids).toContain(wedge[0].id);
  expect(ids).toContain(named(data, 'Biggs Darklighter')[0].id);
  expect(ids).toContain(named(data, 'Mon Mothma')[0].id);
});

test('meeting attendees: add a person from the meeting form', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-echo');
  await page.getByRole('button', { name: 'Add meeting' }).click();
  const form = page.getByRole('dialog', { name: 'New meeting' });
  await form.getByLabel('Title').fill('Pilot briefing');
  await form.getByLabel('Date').fill('+1d');
  await form.getByLabel('Date').press('Tab');
  const attendees = form.getByRole('group', { name: 'Attendees' });
  await attendees.getByRole('button', { name: 'Add a person' }).click();
  const name = attendees.getByRole('textbox', { name: 'New person’s name' });
  await name.fill('Wedge Antilles');
  await name.press('Enter');
  await expect(
    attendees.getByRole('checkbox', { name: 'Wedge Antilles' }),
  ).toBeChecked();
  await name.press('Escape');
  await form.getByRole('button', { name: 'Add meeting' }).click();
  await expect(form).toBeHidden();
  await expectSaved(page);
  const data = await stored(request);
  const meeting = Object.values(data.meetings).find(
    (m) => m.title === 'Pilot briefing',
  );
  expect(meeting?.attendees).toEqual([named(data, 'Wedge Antilles')[0].id]);
});

test('the assignee picker adds a person and assigns them', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-echo');
  await page
    .locator('[data-task-id]')
    .filter({ hasText: 'Insulate the hangar doors' })
    .getByRole('button', { name: 'Insulate the hangar doors', exact: true })
    .click();
  const panel = page.getByRole('dialog', { name: 'Task' });
  const who = panel.getByRole('combobox', { name: 'Assignee' });

  // Escape cancels and leaves the panel open.
  await who.click();
  await page.getByRole('option', { name: 'Add a person…' }).click();
  const name = panel.getByRole('textbox', { name: 'New assignee’s name' });
  await expect(name).toBeFocused();
  await name.press('Escape');
  await expect(name).toBeHidden();
  await expect(panel).toBeVisible();

  // A known name assigns that person.
  await who.click();
  await page.getByRole('option', { name: 'Add a person…' }).click();
  await name.fill('han solo');
  await name.press('Enter');
  await expect(name).toBeHidden();
  await expect(who).toHaveValue('Han Solo');

  await who.click();
  await page.getByRole('option', { name: 'Add a person…' }).click();
  await name.fill('Wedge Antilles');
  await name.press('Enter');
  await expect(name).toBeHidden();
  await expect(who).toHaveValue('Wedge Antilles');
  await expect(who).toBeFocused();

  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel).toBeHidden();
  await expectSaved(page);
  const data = await stored(request);
  expect(named(data, 'Han Solo')).toHaveLength(1);
  const wedge = named(data, 'Wedge Antilles');
  expect(wedge).toHaveLength(1);
  expect(data.tasks['t-2'].assignee).toBe(wedge[0].id);
});

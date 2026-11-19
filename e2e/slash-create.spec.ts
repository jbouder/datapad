import type { APIRequestContext, Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  expectNote,
  expectSaved,
  openLive,
  SEED,
  test,
  today,
} from './fixtures';

/** `/` commands that make things (#375), in the capture line and a note. */

interface Stored {
  meetings: Record<
    string,
    { title: string; date: string; time: string; attendees: string[] }
  >;
  people: Record<string, { name: string }>;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

const capture = (page: Page) => page.getByRole('combobox', { name: 'Capture' });
const chips = (page: Page) =>
  page.getByRole('list', { name: 'Will be saved as' }).getByRole('listitem');
const toast = (page: Page) => page.getByRole('status').filter({ hasText: /./ });

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test('the capture line makes a meeting from /meeting, with Undo', async ({
  page,
  request,
}) => {
  await openLive(page);
  await capture(page).click();
  await page.keyboard.type('/mee');
  const menu = page.getByRole('listbox', { name: 'Commands' });
  await expect(menu.getByRole('option')).toHaveText([/^\/meeting/]);
  await expectAccessible(page);
  await page.keyboard.press('Enter');
  await expect(capture(page)).toHaveValue('/meeting ');
  await page.keyboard.type('Hangar walkthrough at 2pm');
  await expect(chips(page).first()).toHaveText('Meeting');
  await expectNoSidewaysScroll(page);
  await capture(page).press('Enter');
  await expect(capture(page)).toHaveValue('');
  await expect(toast(page)).toContainText('Added a meeting to General');
  await expectSaved(page);
  let data = await stored(request);
  const meeting = Object.values(data.meetings).find(
    (m) => m.title === 'Hangar walkthrough',
  );
  expect(meeting).toMatchObject({ date: today(), time: '14:00' });

  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expectSaved(page);
  data = await stored(request);
  expect(
    Object.values(data.meetings).some((m) => m.title === 'Hangar walkthrough'),
  ).toBe(false);
});

test('/person in a note adds them to People and mentions them', async ({
  page,
  request,
}) => {
  await openLive(page, '/scratch');
  const box = page.getByRole('textbox', { name: 'New block' });
  await box.click();
  await page.keyboard.type('Lando Calrissian /pers');
  const menu = page.getByRole('listbox', { name: 'Commands' });
  await expect(menu.getByRole('option', { selected: true })).toContainText(
    'Person',
  );
  await page.keyboard.press('Enter');
  await expectNote(box, '@Lando Calrissian');
  await expect(toast(page)).toContainText('Added Lando Calrissian to People');
  await expectSaved(page);
  const data = await stored(request);
  expect(
    Object.values(data.people).some((p) => p.name === 'Lando Calrissian'),
  ).toBe(true);
});

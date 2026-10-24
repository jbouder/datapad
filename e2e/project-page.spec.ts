import {
  expect,
  expectSaved,
  isMobile,
  openLive,
  SEED,
  test,
} from './fixtures';

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test('from a card to the project, then edit the state line', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects');
  await page
    .getByRole('list', { name: 'Projects' })
    .getByRole('link', { name: /Echo Base relocation/ })
    .click();
  await expect(page).toHaveURL(/\/projects\/p-echo$/);
  await expect(page).toHaveTitle('Echo Base relocation · Datapad');

  const line = page.getByRole('textbox', { name: 'Current state' });
  await expect(line).toHaveValue('Shield generator parts arrive Friday');

  // Esc puts it back and saves nothing.
  await line.fill('Never mind');
  await line.press('Escape');
  await expect(line).toHaveValue('Shield generator parts arrive Friday');

  // Enter blurs and saves.
  await line.fill('Generator installed; testing the shield');
  await line.press('Enter');
  await expect(line).not.toBeFocused();

  // Blurring again without a change logs nothing more.
  await line.focus();
  await line.blur();

  const activity = page.getByRole('button', { name: /^Activity/ });
  await activity.click();
  await expect(activity).toHaveAttribute('aria-expanded', 'true');
  const log = page.getByRole('list', { name: 'Activity' });
  await expect(log.getByRole('listitem').first()).toContainText(
    'Updated current state',
  );
  await expect(log.getByRole('listitem').first()).toContainText('just now');
  await expectSaved(page);

  const data = await (await request.get('/api/export.json')).json();
  expect(
    data.activity['p-echo'].events.filter(
      (e: { text: string }) => e.text === 'Updated current state',
    ),
  ).toHaveLength(1);

  // The card shows it too.
  await page.goto('/projects');
  await expect(
    page
      .getByRole('list', { name: 'Projects' })
      .getByRole('link', { name: /Echo Base relocation/ }),
  ).toContainText('Generator installed; testing the shield');
});

test('activity times say when exactly on focus', async ({ page }) => {
  test.skip(isMobile(page), 'Tooltips on focus are a keyboard concern.');
  await openLive(page, '/projects/p-echo');
  // Open the section, then Tab to the first time (keyboard focus opens it).
  await page.getByRole('button', { name: /^Activity/ }).click();
  const first = page
    .getByRole('list', { name: 'Activity' })
    .getByRole('listitem')
    .first();
  await expect(first).toContainText('Added a note');
  await page.keyboard.press('Tab');
  await expect(first.getByRole('button')).toBeFocused();
  await expect(page.locator('[data-slot="tooltip-content"]')).toContainText(
    /Thu 22 Oct 2026, \d\d:30/,
  );
});

test('sections remember open or closed per project', async ({ page }) => {
  await openLive(page, '/projects/p-echo');
  const tasks = page.getByRole('button', { name: /^Tasks/ });
  await expect(tasks).toHaveAttribute('aria-expanded', 'true');
  await tasks.click();
  await expect(tasks).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('list', { name: 'Open tasks' })).toBeHidden();
  await page.reload();
  await expect(page.getByRole('button', { name: /^Tasks/ })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  // Another project keeps its own setting.
  await page.goto('/projects/p-falcon');
  await expect(page.getByRole('button', { name: /^Tasks/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
});

test('the header carries the project’s facts', async ({ page }) => {
  await openLive(page, '/projects/p-echo');
  const details = page.getByRole('list', { name: 'Details' });
  await expect(details).toContainText('Active');
  await expect(details).toContainText('High');
  await expect(details).toContainText('Target Sat 14 Nov');
  await expect(details).toContainText('Leia Organa');
  await expect(details).toContainText('infra');
  const link = details.getByRole('link', { name: /Relocation plan/ });
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(
    page.getByText('Move the base to Hoth before winter.'),
  ).toBeVisible();
});

test('two columns above 820px, one below', async ({ page }) => {
  await openLive(page, '/projects/p-echo');
  const tasks = await page
    .getByRole('button', { name: /^Tasks/ })
    .boundingBox();
  const notes = await page
    .getByRole('button', { name: /^Notes/ })
    .boundingBox();
  if (isMobile(page)) {
    expect(notes?.y ?? 0).toBeGreaterThan(tasks?.y ?? 0);
  } else {
    expect(Math.abs((notes?.y ?? 0) - (tasks?.y ?? 0))).toBeLessThan(4);
    expect(notes?.x ?? 0).toBeGreaterThan(tasks?.x ?? 0);
  }
});

import { expect, isMobile, openLive, SEED, test } from './fixtures';

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test('from a card to the project; no current state line', async ({ page }) => {
  await openLive(page, '/projects');
  await page
    .getByRole('list', { name: 'Projects' })
    .getByRole('link', { name: /Echo Base relocation/ })
    .click();
  await expect(page).toHaveURL(/\/projects\/p-echo$/);
  await expect(page).toHaveTitle('Echo Base relocation · Datapad');
  // Retired: the seed still has one, and nothing shows it.
  await expect(
    page.getByRole('textbox', { name: 'Current state' }),
  ).toHaveCount(0);
  await expect(page.getByRole('main')).not.toContainText(
    'Shield generator parts arrive Friday',
  );
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
    /Thu 22 Oct 2026, \d{1,2}:30 [AP]M/,
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

test.describe('section motion', () => {
  test.use({ reducedMotion: 'no-preference' });
  test('opening a section only fades it in; nothing inside replays or slides', async ({
    page,
  }) => {
    await openLive(page, '/projects/p-echo');
    const tasks = page.getByRole('button', { name: /^Tasks/ });
    await tasks.click();
    await expect(tasks).toHaveAttribute('aria-expanded', 'false');
    await page.waitForTimeout(400);
    await tasks.click();
    const moving = await page.evaluate(() =>
      document.getAnimations().flatMap((a) => {
        const target = (a.effect as KeyframeEffect | null)?.target;
        if (!(target instanceof Element)) return [];
        // The caret turning and the body's one fade are all there is.
        if (target.matches('.section-body, svg')) return [];
        return [target.outerHTML.slice(0, 80)];
      }),
    );
    expect(moving).toEqual([]);
  });
});

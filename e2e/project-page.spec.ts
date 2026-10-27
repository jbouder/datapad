import { formatDay, formatTimestamp } from '../shared/dates';
import {
  expect,
  isMobile,
  openLive,
  SEED,
  seedDay,
  seedTime,
  test,
  today,
} from './fixtures';

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
    formatTimestamp(seedTime('2026-10-22T16:30:00.000Z'), '12h'),
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
  await expect(details).toContainText(
    `Target ${formatDay(seedDay('2026-11-14'), today())}`,
  );
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
  const milestones = await page
    .getByRole('button', { name: /^Milestones/ })
    .boundingBox();
  const notes = await page
    .getByRole('button', { name: /^Notes/ })
    .boundingBox();
  if (isMobile(page)) {
    expect(notes?.y ?? 0).toBeGreaterThan(milestones?.y ?? 0);
  } else {
    expect(Math.abs((notes?.y ?? 0) - (milestones?.y ?? 0))).toBeLessThan(4);
    expect(notes?.x ?? 0).toBeGreaterThan(milestones?.x ?? 0);
  }
});

test('Milestones, then Tasks, then Meetings', async ({ page }) => {
  await openLive(page, '/projects/p-echo');
  const top = async (name: RegExp) =>
    (await page.getByRole('button', { name }).boundingBox())?.y ?? 0;
  const milestones = await top(/^Milestones/);
  const tasks = await top(/^Tasks/);
  const meetings = await top(/^Meetings/);
  expect(tasks).toBeGreaterThan(milestones);
  expect(meetings).toBeGreaterThan(tasks);
});

test('the header actions wrap with no sideways scroll', async ({ page }) => {
  await openLive(page, '/projects/p-echo');
  await expect(
    page.getByRole('button', { name: 'Save as template' }),
  ).toBeVisible();
  if (isMobile(page)) {
    for (const name of ['Summarize', 'Edit', 'Archive', 'Save as template']) {
      const box = await page
        .getByRole('article', { name: 'Echo Base relocation' })
        .locator('header')
        .getByRole('button', { name, exact: true })
        .boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  }
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
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

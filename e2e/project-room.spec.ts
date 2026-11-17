import type { Page } from '@playwright/test';
import { formatDay } from '../shared/dates';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  isMobile,
  moreActions,
  openLive,
  SEED,
  seedDay,
  test,
  today,
} from './fixtures';

/**
 * The project room (#334): the header with its state line and actions,
 * the people to narrow it to, the Next meeting card, and the Stream,
 * Plan and Whiteboard tabs. The seed's Echo Base relocation (Rebel
 * Alliance) has Leia (you), Han and Chewbacca as members, today's Shield
 * review, Leia's shield generator, Chewbacca's hangar doors, the
 * tauntaun vet, the done ridge survey, a standup note with checkboxes, a
 * prep note on the review, and the Base operational milestone.
 */

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

const stream = (page: Page) => page.getByRole('list', { name: 'Stream' });
const comingUp = (page: Page) => page.getByRole('list', { name: 'Coming up' });

/** Each entry's key, in order: Coming up's, then the stream's. */
async function keysOf(list: ReturnType<Page['getByRole']>) {
  if ((await list.count()) === 0) return [];
  return list
    .locator(':scope > li')
    .evaluateAll((rows) =>
      rows.map(
        (r) =>
          r.getAttribute('data-stream') ??
          `note:${r.getAttribute('data-note-id')}`,
      ),
    );
}
const lanes = (page: Page) =>
  page.getByRole('complementary', { name: 'Open loops' });
const tabs = (page: Page) =>
  page.getByRole('navigation', { name: 'Echo Base relocation room' });
const people = (page: Page) =>
  page.getByRole('navigation', { name: 'Narrow to a person' });

test('the room: header, state line, people, Next meeting and the stream', async ({
  page,
}) => {
  await openLive(page, '/projects/p-echo');
  await expect(page).toHaveTitle('Echo Base relocation · Datapad');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Echo Base relocation',
  );
  await expect(page.getByRole('main')).toContainText('Rebel Alliance');
  const target = formatDay(seedDay('2026-11-14'), today());
  await expect(page.locator('[data-state-line]')).toHaveText(
    `Target ${target} · Next: Base operational, ${target} · 3 open`,
  );

  // Members first, then whoever the tasks touch.
  await expect(people(page).getByRole('link')).toHaveText([
    'Leia Organa (you)',
    'Han Solo',
    'Chewbacca',
  ]);

  const next = page.getByRole('region', { name: 'Next meeting' });
  await expect(next).toContainText('Shield review');
  await expect(
    next.getByRole('link', { name: 'Enter meeting' }),
  ).toHaveAttribute('href', '/meetings/e-1');

  // The tabs, Stream current.
  await expect(tabs(page).getByRole('link')).toHaveText([
    'Stream',
    'Plan',
    'Whiteboard',
  ]);
  await expect(
    tabs(page).getByRole('link', { name: 'Stream' }),
  ).toHaveAttribute('aria-current', 'page');

  // The lanes: the shield generator is mine, the doors wait on Chewbacca.
  await expect(lanes(page).getByRole('list', { name: 'Mine' })).toContainText(
    'Confirm shield generator delivery',
  );
  await expect(
    lanes(page).getByRole('list', { name: 'Waiting on Chewbacca' }),
  ).toContainText('Insulate the hangar doors');

  // Coming up: the milestone ahead, and the review if it is still to
  // come today. Then the stream: the rest, newest first, done tasks twice.
  const upcoming = await keysOf(comingUp(page));
  const past = await keysOf(stream(page));
  expect(upcoming.at(-1)).toBe('milestone:e-2');
  expect([...upcoming, ...past].sort()).toEqual(
    [
      'milestone:e-2',
      'meeting:e-1',
      'note:n-2',
      'added:t-4',
      'note:n-1',
      'done:t-3',
      'added:t-3',
      'added:t-2',
      'added:t-1',
    ].sort(),
  );
  expect(past.filter((k) => k !== 'meeting:e-1')).toEqual([
    'note:n-2',
    'added:t-4',
    'note:n-1',
    'done:t-3',
    'added:t-3',
    'added:t-2',
    'added:t-1',
  ]);
  // Notes are open, with their checkboxes.
  await expect(
    stream(page).getByRole('checkbox', { name: 'Check the heaters' }),
  ).toBeVisible();

  await expectNoSidewaysScroll(page);
  await expectAccessible(page);
});

test('a note’s checkbox ticks in place in the stream', async ({ page }) => {
  await openLive(page, '/projects/p-echo');
  const box = stream(page).getByRole('checkbox', { name: 'Check the heaters' });
  await expect(box).not.toBeChecked();
  await box.click();
  await expect(box).toBeChecked();
  await page.reload();
  await expect(
    stream(page).getByRole('checkbox', { name: 'Check the heaters' }),
  ).toBeChecked();
});

test('capture in a room files to it', async ({ page }) => {
  await openLive(page, '/projects/p-echo');
  const capture = page.getByRole('combobox', { name: /capture/i });
  await capture.fill('Ask about the snowspeeders');
  await capture.press('Enter');
  await expect(stream(page).locator(':scope > li').first()).toContainText(
    'Ask about the snowspeeders',
  );
});

test('narrow to a person: lanes and stream, the address, capture and Clear', async ({
  page,
}) => {
  await openLive(page, '/projects/p-echo');
  await people(page).getByRole('link', { name: 'Chewbacca' }).click();
  await expect(page).toHaveURL(/\/projects\/p-echo\?person=u-chewie$/);
  await expect(
    people(page).getByRole('link', { name: 'Chewbacca' }),
  ).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('[data-state-line]')).toContainText(
    'Narrowed to Chewbacca',
  );
  // The doors, and the standup note that mentions him.
  await expect(stream(page).locator(':scope > li')).toHaveCount(2);
  await expect(stream(page)).toContainText('Insulate the hangar doors');
  await expect(stream(page)).toContainText('has the hangar keys');
  await expect(comingUp(page)).toHaveCount(0);
  await expect(lanes(page).getByRole('list', { name: 'Mine' })).toHaveCount(0);

  // It survives a reload, and the tabs keep it.
  await page.reload();
  await expect(stream(page).locator(':scope > li')).toHaveCount(2);
  await expect(tabs(page).getByRole('link', { name: 'Plan' })).toHaveAttribute(
    'href',
    '/projects/p-echo/plan?person=u-chewie',
  );

  // A note captured here mentions them; a task is theirs.
  const capture = page.getByRole('combobox', { name: /capture/i });
  await capture.fill('Bring the spare insulation');
  await capture.press('Enter');
  await expect(stream(page).locator(':scope > li')).toHaveCount(3);
  await expect(stream(page).locator(':scope > li').first()).toContainText(
    'Bring the spare insulation',
  );
  await expect(stream(page).locator(':scope > li').first()).toContainText(
    'Chewbacca',
  );
  await capture.fill('todo Check the heater coils');
  await capture.press('Enter');
  await expect(
    lanes(page).getByRole('list', { name: 'Waiting on Chewbacca' }),
  ).toContainText('Check the heater coils');

  // Pinned as a pair, it shows in the rail by both names.
  await page.getByRole('button', { name: 'Pin' }).click();
  await expect(page.getByRole('button', { name: 'Pin' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  if (!isMobile(page)) {
    await expect(
      page
        .getByRole('complementary', { name: 'Datapad' })
        .getByRole('link', { name: 'Echo Base relocation · Chewbacca' }),
    ).toHaveAttribute('aria-current', 'page');
  }

  await page.getByRole('link', { name: 'Clear' }).click();
  await expect(page).toHaveURL(/\/projects\/p-echo$/);
  await expect
    .poll(
      async () =>
        (await keysOf(comingUp(page))).length +
        (await keysOf(stream(page))).length,
    )
    .toBe(11);
  await expect(page.getByRole('button', { name: 'Pin' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('Plan: description, details, timeline, milestones, members, links, Activity', async ({
  page,
}) => {
  await openLive(page, '/projects/p-echo');
  await tabs(page).getByRole('link', { name: 'Plan' }).click();
  await expect(page).toHaveURL(/\/projects\/p-echo\/plan$/);
  await expect(tabs(page).getByRole('link', { name: 'Plan' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const main = page.getByRole('main');
  for (const name of [
    'Description',
    'Timeline',
    'Details',
    'Members',
    'Links',
  ]) {
    await expect(
      main.getByRole('heading', { name, exact: true }),
    ).toBeVisible();
  }
  await expect(main.getByRole('list', { name: 'Members' })).toContainText(
    'Han Solo',
  );
  await expect(
    main.getByRole('link', { name: 'Relocation plan' }),
  ).toBeVisible();
  await expect(main.getByRole('button', { name: /^Milestones/ })).toBeVisible();
  const activity = main.getByRole('button', { name: /^Activity/ });
  await expect(activity).toHaveAttribute('aria-expanded', 'false');
  await activity.click();
  await expect(main.getByRole('list', { name: 'Activity' })).toBeVisible();

  // Health sets in place, and the state line says it.
  await main
    .getByRole('group', { name: 'Health' })
    .getByText('Red', { exact: true })
    .click();
  await expect(page.locator('[data-state-line]')).toContainText('Red');

  await expectNoSidewaysScroll(page);
  await expectAccessible(page);
});

test('a milestone in the stream opens the Plan at it', async ({ page }) => {
  await openLive(page, '/projects/p-echo');
  await comingUp(page)
    .getByRole('link', { name: /Base operational/ })
    .click();
  await expect(page).toHaveURL(/\/projects\/p-echo\/plan\?milestone=e-2$/);
  await expect(page.locator('[data-milestone-id="e-2"]')).toBeFocused();
});

test('Whiteboard: the board in the room, and its address', async ({ page }) => {
  await openLive(page, '/projects/p-echo');
  await tabs(page).getByRole('link', { name: 'Whiteboard' }).click();
  await expect(page).toHaveURL(/\/projects\/p-echo\/whiteboard$/);
  await expect(
    page.getByRole('application', {
      name: 'Whiteboard for Echo Base relocation',
    }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Board menu' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Echo Base relocation',
  );
  await expectNoSidewaysScroll(page);
  await expectAccessible(page);

  // Back to the Stream, the same page.
  await tabs(page).getByRole('link', { name: 'Stream' }).click();
  await expect(page).toHaveURL(/\/projects\/p-echo$/);
  await expect(stream(page)).toBeVisible();
});

test('every action the classic page had is in the header', async ({ page }) => {
  await openLive(page, '/projects/p-echo');
  await expect(
    page.getByRole('button', { name: 'Edit', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Schedule meeting' }),
  ).toBeVisible();
  expect(await moreActions(page)).toEqual([
    'Summarize',
    'Pause',
    'Mark done',
    'Save as template',
    'Archive',
    'Delete',
  ]);

  // Status from the menu, with Undo.
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Pause' }).click();
  await expect(page.locator('[data-state-line]')).toContainText('Paused');

  // Delete asks first.
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete project' });
  await expect(dialog).toContainText(
    'Delete Echo Base relocation and its 4 tasks, 2 notes, 1 milestone and activity?',
  );
  await dialog.getByRole('button', { name: 'Delete project' }).click();
  await expect(page).toHaveURL(/\/all\?kind=project$/);
});

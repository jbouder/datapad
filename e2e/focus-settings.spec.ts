import type { APIRequestContext, Page } from '@playwright/test';
import {
  briefingSeed,
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  openLive,
  test,
} from './fixtures';

/**
 * Focus's settings (#311): hide and reorder its sections in Settings →
 * Pages, whose tasks it shows (Tasks for, `?who=`), how Due is grouped
 * (`?group=`), and the rules behind Attention and Follow-ups.
 */

interface Stored {
  settings: {
    user?: { pages?: Record<string, Record<string, unknown>> };
  };
}

/** Wait until the server has `expected` for Focus. */
async function expectStored(request: APIRequestContext, expected: unknown) {
  await expect
    .poll(async () => {
      const file = (await (
        await request.get('/api/export.json')
      ).json()) as Stored;
      return file.settings.user?.pages?.focus ?? null;
    })
    .toEqual(expected);
}

const focusCard = (page: Page) =>
  page.getByRole('region', { name: 'Focus', exact: true });
const section = (page: Page, name: string) =>
  page.getByRole('button', { name: new RegExp(`^${name}`) });
const due = (page: Page) => page.getByRole('region', { name: 'Due' });
const dueTitles = (page: Page) => due(page).getByRole('heading', { level: 2 });
const attention = (page: Page) =>
  page.getByRole('list', { name: 'Projects that need attention' });

/** Click a visually hidden radio's label. */
async function pick(
  page: Page,
  scope: ReturnType<Page['locator']>,
  name: string,
) {
  await scope
    .locator('label')
    .filter({ has: page.getByRole('radio', { name, exact: true }) })
    .click();
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: briefingSeed() });
});

test('hide a section and move one up in Settings → Pages', async ({
  page,
  request,
}) => {
  await openLive(page, '/settings/pages');
  const editor = page.getByRole('list', { name: 'Focus sections' });
  await editor.getByRole('switch', { name: 'Show Attention' }).click();
  // Due to the top: five places up.
  const dueUp = editor.getByRole('button', { name: 'Move Due up' });
  for (let i = 0; i < 5; i++) await dueUp.click();
  await expect(dueUp).toBeDisabled();
  await expectStored(request, {
    hidden: ['attention'],
    order: ['due', 'recap', 'agenda', 'waiting', 'attention', 'followUps'],
  });
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  await openLive(page);
  await expect(section(page, 'Waiting on')).toBeVisible();
  await expect(section(page, 'Attention')).toHaveCount(0);
  await expect(attention(page)).toHaveCount(0);
  // Due comes first, above Since yesterday and Waiting on.
  const dueBox = await due(page).boundingBox();
  const recapBox = await section(page, 'Since yesterday').boundingBox();
  const waitingBox = await section(page, 'Waiting on').boundingBox();
  expect(dueBox?.y ?? 0).toBeLessThan(recapBox?.y ?? 0);
  expect(dueBox?.y ?? 0).toBeLessThan(waitingBox?.y ?? 0);
  // Collapsing still works.
  await section(page, 'Waiting on').click();
  await expect(section(page, 'Waiting on')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

test('Tasks for: Mine narrows Due, Waiting on and Follow-ups', async ({
  page,
}) => {
  await openLive(page);
  const tasksFor = page.getByRole('group', { name: 'Tasks for' });
  await expect(tasksFor.getByRole('radio', { name: 'Anyone' })).toBeChecked();
  await pick(page, tasksFor, 'Mine');
  await expect(page).toHaveURL(/\?who=mine$/);

  // Leia Organa is marked as me: her overdue task, her action item.
  await expect(dueTitles(page)).toHaveText([/^High priority/]);
  await expect(due(page)).toContainText('Confirm shield generator delivery');
  await expect(due(page)).not.toContainText('Book the tauntaun vet');
  // Nothing blocked is assigned to her.
  await expect(section(page, 'Waiting on')).toHaveCount(0);
  await expect(
    page
      .getByRole('list', { name: 'Action items from Shield review' })
      .getByRole('listitem'),
  ).toHaveText([/Send the ridge survey/]);
  // Projects are no one's.
  await expect(attention(page).getByRole('listitem')).toHaveCount(2);
  await expectNoSidewaysScroll(page);
  await expectAccessible(page);

  // Saved: a bare address opens Mine; `?who=anyone` shows everyone's.
  await openLive(page);
  await expect(tasksFor.getByRole('radio', { name: 'Mine' })).toBeChecked();
  await openLive(page, '/?who=anyone');
  await expect(section(page, 'Waiting on')).toBeVisible();
});

test('Group Due by Date, and Attention follows its rules', async ({
  page,
  request,
}) => {
  await openLive(page, '/?group=date');
  await expect(dueTitles(page)).toHaveText([/^Overdue/, /^Today/]);
  await expect(
    page.getByRole('list', { name: 'Overdue', exact: true }),
  ).toContainText('Confirm shield generator delivery');
  await expect(
    page.getByRole('list', { name: 'Today', exact: true }),
  ).toContainText('Book the tauntaun vet');

  await openLive(page, '/settings/pages');
  const card = focusCard(page);
  await pick(
    page,
    card.getByRole('group', { name: 'Attention: yellow health' }),
    'Leave out',
  );
  await card.getByRole('combobox', { name: 'Attention: quiet after' }).click();
  await page.getByRole('option', { name: 'Off', exact: true }).click();
  await expectStored(request, {
    filters: { yellow: 'leave', quiet: 'off' },
  });

  // Echo Base is only yellow; Endor is red and near its target, no
  // longer quiet.
  await openLive(page);
  await expect(attention(page).getByRole('listitem')).toHaveCount(1);
  await expect(attention(page).getByRole('listitem')).toContainText(
    'red · target in 6 days',
  );
  await expect(attention(page)).not.toContainText('quiet');
  // The rules are never in the address.
  await expect(page).not.toHaveURL(/quiet|yellow/);
});

import type { Page } from '@playwright/test';
import {
  expect,
  expectNoSidewaysScroll,
  openLive,
  SEED,
  test,
} from './fixtures';

/**
 * The project page's saved sections (#312), hidden and moved. Settings →
 * Pages, where they were set, went with v2 (#343); the project room
 * (#334) replaces the page. (Meetings shows gave way to Show past, #320:
 * `project-show-past.spec.ts`.)
 */

/** The project page's section headings, top to bottom. */
function headings(page: Page) {
  return page
    .getByRole('main')
    .getByRole('heading', { level: 2 })
    .filter({ has: page.locator('button[aria-expanded]') });
}

test('the project page shows its sections hidden and moved as saved', async ({
  page,
  request,
}) => {
  await request.post('/api/import', {
    data: {
      ...SEED,
      settings: {
        user: {
          defaultOrg: '',
          pages: {
            project: {
              order: [
                'meetings',
                'milestones',
                'tasks',
                'notes',
                'lists',
                'whiteboard',
                'activity',
              ],
              hidden: ['whiteboard'],
            },
          },
        },
      },
    },
  });

  await openLive(page, '/projects/p-echo');
  const names = headings(page);
  await expect(names.first()).toHaveText(/^Meetings/);
  await expect(names.nth(1)).toHaveText(/^Milestones/);
  await expect(names.nth(2)).toHaveText(/^Tasks/);
  await expect(names.filter({ hasText: /^Whiteboard/ })).toHaveCount(0);
  await expect(names.filter({ hasText: /^Notes/ })).toHaveCount(1);
  await expectNoSidewaysScroll(page);
});

import { expectAccessible, openLive, SEED, test } from './fixtures';

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

for (const view of ['list', 'table', 'board', 'timeline']) {
  test.describe(`${view} layout`, () => {
    test.use({ reducedMotion: 'reduce' });
    test('is axe clean', async ({ page }) => {
      await openLive(page, `/tasks?view=${view}`);
      await expectAccessible(page);
    });
  });
}

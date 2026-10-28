import { expect, expectAccessible, openLive, SEED, test } from './fixtures';

/**
 * A document's links open in a new tab only when they are `https:`,
 * `http:` or `mailto:`, as in Markdown. Anything else, which an import or
 * an MCP client could put there, is shown as text and is never a link.
 */

const BAD = 'javascript:alert(document.domain)';

test.beforeEach(async ({ request }) => {
  const project = SEED.projects['p-echo'];
  const meeting = SEED.meetings['e-1'];
  await request.post('/api/import', {
    data: {
      ...SEED,
      projects: {
        ...SEED.projects,
        'p-echo': {
          ...project,
          links: [
            { type: 'doc', url: 'https://example.com/plan', label: 'Plan' },
            { type: 'link', url: BAD, label: 'Trap' },
          ],
        },
      },
      meetings: { ...SEED.meetings, 'e-1': { ...meeting, link: BAD } },
    },
  });
});

test('a project shows a javascript: link as text', async ({ page }) => {
  await openLive(page, '/projects/p-echo');
  const header = page.locator('#main header').first();
  await expect(header.getByRole('link', { name: /^Plan/ })).toHaveAttribute(
    'href',
    'https://example.com/plan',
  );
  await expect(header.getByRole('link', { name: /Trap/ })).toHaveCount(0);
  await expect(header.getByText(BAD)).toBeVisible();
  expect(await page.locator('a[href^="javascript:" i]').count()).toBe(0);
  await expectAccessible(page);
});

test('a meeting with a javascript: link offers no link', async ({ page }) => {
  await openLive(page, '/meetings/e-1');
  await expect(
    page.locator('#main').getByRole('link', { name: /Join or open/ }),
  ).toHaveCount(0);
  await expect(page.locator('#main').getByText(BAD)).toBeVisible();
  expect(await page.locator('a[href^="javascript:" i]').count()).toBe(0);

  await openLive(page, '/meetings');
  await expect(page.getByRole('link', { name: /^Link for/ })).toHaveCount(0);
  expect(await page.locator('a[href^="javascript:" i]').count()).toBe(0);
});

import {
  expect,
  openLive,
  openPreferences,
  SEED,
  SEED_COUNTS,
  test,
} from './fixtures';

test('signs in through the dev bypass as this test’s own address', async ({
  page,
  email,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Focus' }),
  ).toBeVisible();
  await openPreferences(page);
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  await expect(
    page.getByRole('menuitem', { name: 'Sign out' }),
  ).toHaveAttribute('href', '/cdn-cgi/access/logout');
});

// Isolation, two ways: the Worker sees a different address per test, and so
// a different Durable Object (the name is the address). Serial, so test 2
// runs after test 1 has written the seed into its own object.
test.describe
  .serial('isolation', () => {
    const seen: string[] = [];
    for (const n of [1, 2]) {
      test(`test ${n} gets its own identity and an empty object`, async ({
        request,
        email,
      }) => {
        const config = await (await request.get('/api/config')).json();
        expect(config).toEqual({ email });
        expect(seen).not.toContain(email);
        seen.push(email);

        // Whatever test 1 wrote is absent here.
        const before = await (await request.get('/api/export.json')).json();
        expect(Object.keys(before.projects)).toEqual([]);
        expect(Object.keys(before.tasks)).toEqual([]);

        const imported = await request.post('/api/import', { data: SEED });
        expect(imported.status()).toBe(200);
        expect(await imported.json()).toEqual({ imported: SEED_COUNTS });
      });
    }
  });

test('deep links load the app, not a 404', async ({ page }) => {
  const response = await page.goto('/projects/does-not-exist-yet');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('banner')).toBeVisible();
});

test('every page has its own title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Focus · Datapad');
  await page.getByRole('link', { name: 'Help' }).click();
  await expect(page).toHaveURL(/\/help$/);
  await expect(page).toHaveTitle('Help · Datapad');
  await page.goBack();
  await expect(page).toHaveTitle('Focus · Datapad');
});

test('the top bar shows the title only once the h1 scrolls away', async ({
  page,
  request,
}) => {
  await request.post('/api/import', { data: SEED });
  await page.setViewportSize({
    width: page.viewportSize()?.width ?? 390,
    height: 360,
  });
  await openLive(page, '/projects/p-echo');
  const echo = page.getByRole('banner').getByText('Echo Base relocation');
  await expect(echo).not.toHaveAttribute('data-shown');
  await page.mouse.wheel(0, 600);
  await expect(echo).toHaveAttribute('data-shown', 'true');
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(echo).not.toHaveAttribute('data-shown');
});

test('the theme choice persists and applies before first paint', async ({
  page,
}) => {
  await page.goto('/');
  await openPreferences(page);
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  const html = page.locator('html');
  await expect(html).toHaveClass(/\bdark\b/);
  await page.reload();
  await expect(html).toHaveClass(/\bdark\b/);
  await openPreferences(page);
  await page.getByRole('menuitemradio', { name: 'Light' }).click();
  await expect(html).not.toHaveClass(/\bdark\b/);
  await page.reload();
  await expect(html).not.toHaveClass(/\bdark\b/);
});

test('nothing is requested from another origin', async ({ page }) => {
  const foreign: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).hostname !== 'localhost') foreign.push(r.url());
  });
  await page.goto('/');
  await page.getByRole('link', { name: 'Help' }).click();
  await expect(page).toHaveURL(/\/help$/);
  expect(foreign).toEqual([]);
});

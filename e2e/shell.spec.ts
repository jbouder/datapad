import { expect, openPreferences, test } from './fixtures';

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
// a different Durable Object (the name is the address). M1 adds a check
// that data written in one test is absent from the next.
const seen: string[] = [];
for (const n of [1, 2]) {
  test(`test ${n} gets its own identity`, async ({ request, email }) => {
    const config = await (await request.get('/api/config')).json();
    expect(config).toEqual({ email });
    expect(seen).not.toContain(email);
    seen.push(email);
  });
}

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

import { expect, openLive, test } from './fixtures';

/**
 * Installable: the manifest and every icon it names load (through the
 * Access check, with the session cookie, like everything else), and the
 * page links them. No service worker by decision (docs/design.md § PWA).
 */

test('links a manifest that opens Focus standalone, with working icons', async ({
  page,
  request,
}) => {
  await openLive(page, '/');
  const link = page.locator('link[rel="manifest"]');
  await expect(link).toHaveAttribute('href', '/site.webmanifest');
  // Behind Access, a manifest fetched without credentials gets the login.
  await expect(link).toHaveAttribute('crossorigin', 'use-credentials');

  const response = await request.get('/site.webmanifest');
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    name: 'Datapad',
    start_url: '/focus',
    scope: '/',
    display: 'standalone',
  });
  const purposes = manifest.icons.map((i: { purpose: string }) => i.purpose);
  expect(purposes).toContain('maskable');
  for (const icon of manifest.icons as { src: string; sizes: string }[]) {
    const file = await request.get(icon.src);
    expect(file.ok(), icon.src).toBe(true);
  }
  for (const href of ['/apple-touch-icon.png', '/favicon.ico', '/og.png']) {
    expect((await request.get(href)).ok(), href).toBe(true);
  }

  // The installed app's start URL is Focus.
  await openLive(page, '/focus');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Focus' }),
  ).toBeVisible();
});

test('the browser chrome follows the picked theme', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('datapad:theme', 'dark'));
  await openLive(page, '/');
  const colors = await page
    .locator('meta[name="theme-color"]')
    .evaluateAll((metas) => metas.map((m) => m.getAttribute('content')));
  expect(colors).toEqual(['#0a0a0a', '#0a0a0a']);
});

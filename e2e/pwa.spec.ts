import { expect, openLive, test } from './fixtures';

/**
 * Installable: the manifest loads (through the Access check, with the
 * session cookie, like everything else) and the page links it. The icons a
 * phone installs from are embedded as data: URLs, so a home screen never
 * has to fetch one without the cookie (#219). No service worker by
 * decision (docs/design.md § PWA).
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
  // Each icon is embedded and decodes to an image of its declared size.
  const touch = await page
    .locator('link[rel="apple-touch-icon"]')
    .getAttribute('href');
  const icons = [
    ...(manifest.icons as { src: string; sizes: string }[]),
    { src: touch ?? '', sizes: '180x180' },
  ];
  for (const icon of icons) {
    expect(icon.src.startsWith('data:image/'), icon.sizes).toBe(true);
    const size = await page.evaluate(
      (src) =>
        new Promise<string>((resolve, reject) => {
          const img = new Image();
          img.onload = () =>
            resolve(
              img.src.startsWith('data:image/svg')
                ? 'any'
                : `${img.naturalWidth}x${img.naturalHeight}`,
            );
          img.onerror = () => reject(new Error('icon did not decode'));
          img.src = src;
        }),
      icon.src,
    );
    expect(size).toBe(icon.sizes);
  }
  // The files stay in public/ for the favicon and link previews.
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

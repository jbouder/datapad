import { expect, openLive, SEED, test } from './fixtures';

/** The renderer's styles, on the dev-only /dev/components sample. */
test('renders every style, keeps HTML as text, toggles a checklist', async ({
  page,
}) => {
  await openLive(page, '/dev/components');
  const sample = page.locator('.prose-note').first();

  await expect(sample.locator('h3.note-h1')).toHaveText('Heading one');
  await expect(sample.locator('h4.note-h2')).toHaveText('Heading two');
  await expect(sample.locator('h5.note-h3')).toHaveText('Heading three');
  await expect(sample.locator('strong')).toHaveText('bold');
  await expect(sample.locator('em')).toHaveText('italic');
  await expect(sample.locator('s')).toHaveText('strike');
  await expect(sample.locator('blockquote')).toHaveText(
    'A quote, kept as said.',
  );
  await expect(sample.locator('hr')).toHaveCount(1);
  await expect(sample.locator('pre')).toHaveText('const answer = 42;');
  await expect(sample.locator('b')).toHaveCount(0);
  await expect(sample).toContainText('<b>no HTML</b>');

  const link = sample.getByRole('link', { name: /example\.com/ });
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');

  const open = sample.getByRole('checkbox', { name: 'an open item' });
  await expect(open).not.toBeChecked();
  await open.click();
  await expect(open).toBeChecked();
  await expect(
    sample.getByRole('checkbox', { name: 'a done item' }),
  ).toBeChecked();
});

test('copies a code block', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'clipboard permissions');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openLive(page, '/dev/components');
  await page.getByRole('button', { name: 'Copy ts code' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Copied' }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'const answer = 42;',
  );
});

test('a project description renders as Markdown, mentions by name', async ({
  page,
  request,
}) => {
  const seed = structuredClone(SEED);
  seed.projects['p-echo'].desc =
    '## Scope\n- Shield generator\n\nOwner: @{u-leia}, see `ops/hoth`.';
  await request.post('/api/import', { data: seed });
  await openLive(page, '/projects/p-echo');
  const desc = page.locator('header .prose-note');
  await expect(desc.locator('h4')).toHaveText('Scope');
  await expect(desc.locator('li')).toHaveText('Shield generator');
  await expect(desc.locator('.mention')).toHaveText('@Leia Organa');
  await expect(desc.locator('code')).toHaveText('ops/hoth');
});

import type { Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  isMobile,
  openLive,
  SEED,
  test,
} from './fixtures';

/** The composer sample on /dev/components, with its live preview. */
async function open(page: Page) {
  await openLive(page, '/dev/components');
  const box = page.getByRole('combobox', { name: 'Composer' });
  await box.click();
  return { box, preview: page.getByTestId('composer-preview') };
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test('writes a note with / commands, ⌘B, a mention and a fenced block', async ({
  page,
}) => {
  const { box, preview } = await open(page);
  const kb = page.keyboard;

  await kb.type('/h2');
  const menu = page.getByRole('listbox', { name: 'Commands' });
  await expect(menu).toBeVisible();
  await expect(box).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.getByRole('option', { selected: true })).toContainText(
    'Heading 2',
  );
  await kb.press('Enter');
  await kb.type('Standup');
  await kb.press('Enter');

  await kb.type('/checklist');
  await kb.press('Enter');
  await kb.type('Feed the tauntauns');
  await kb.press('Enter'); // continues the checklist
  await kb.type('Check heaters');
  await kb.press('Enter');
  await kb.press('Enter'); // an empty item ends the list

  await kb.type('Ask ');
  await kb.press('ControlOrMeta+b');
  await kb.type('now');
  await kb.press('ArrowRight');
  await kb.press('ArrowRight');
  await kb.type(' @le');
  const people = page.getByRole('listbox', { name: 'People' });
  await expect(people.getByRole('option')).toHaveText([/^Leia Organa/]);
  await kb.press('Enter');
  await kb.press('Enter');

  await kb.type('/code');
  await kb.press('Enter');
  await kb.type('/not a command');
  await expect(menu).toBeHidden();

  await expect(box).toHaveValue(
    '## Standup\n- [ ] Feed the tauntauns\n- [ ] Check heaters\nAsk **now** @Leia Organa \n```\n/not a command\n```',
  );
  await expect(preview.locator('h4')).toHaveText('Standup');
  await expect(preview.locator('.note-checklist li')).toHaveCount(2);
  await expect(preview.locator('strong')).toHaveText('now');
  await expect(preview.locator('.mention')).toHaveText('@Leia Organa');
  await expect(preview.locator('pre')).toHaveText('/not a command');
});

test('shortcuts toggle, Tab in a list stays put, / mid-word does nothing', async ({
  page,
}) => {
  const { box } = await open(page);
  const kb = page.keyboard;
  await kb.type('and/or');
  await expect(page.getByRole('listbox', { name: 'Commands' })).toBeHidden();
  await box.fill('');

  await kb.type('Plan');
  await kb.press('ControlOrMeta+Alt+Digit1');
  await expect(box).toHaveValue('# Plan');
  await kb.press('ControlOrMeta+Alt+Digit1');
  await expect(box).toHaveValue('Plan');
  await kb.press('ControlOrMeta+Shift+Digit9');
  await expect(box).toHaveValue('- [ ] Plan');
  await kb.press('Tab');
  await expect(box).toBeFocused();
  await expect(box).toHaveValue('- [ ] Plan');

  await box.fill('');
  await kb.type('gone');
  await kb.press('ControlOrMeta+a');
  await kb.press('ControlOrMeta+Shift+KeyX');
  await expect(box).toHaveValue('~~gone~~');
  await kb.press('ControlOrMeta+z');
  await expect(box).toHaveValue('gone');
});

test('/date tomorrow, Esc closes the menu, ⌘Enter submits', async ({
  page,
}) => {
  const { box } = await open(page);
  const kb = page.keyboard;
  await kb.type('/h');
  await kb.press('Escape');
  await expect(page.getByRole('listbox', { name: 'Commands' })).toBeHidden();
  await box.fill('');
  await kb.type('Due /date tomorrow');
  await kb.press('Enter');
  const tomorrow = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  await expect(box).toHaveValue(`Due ${tomorrow}`);
  await kb.press('ControlOrMeta+Enter');
  await expect(page.locator('output.toast')).toContainText(
    'Would add the note',
  );
  await expect(box).toHaveValue('');
});

test('the draft survives leaving and coming back', async ({ page }) => {
  const { box } = await open(page);
  await page.keyboard.type('half a thought');
  await page.getByRole('link', { name: 'Tasks' }).first().click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Tasks' }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('combobox', { name: 'Composer' })).toHaveValue(
    'half a thought',
  );
  await expect(box).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ theme, reducedMotion: 'reduce' });
    test('formatting bar on phones only; menus are axe clean', async ({
      page,
    }) => {
      const { box } = await open(page);
      const bar = page.getByRole('group', { name: 'Formatting' }).first();
      if (isMobile(page)) {
        await expect(bar).toBeVisible();
        await page.keyboard.type('loud');
        await page.keyboard.press('ControlOrMeta+a');
        await bar.getByRole('button', { name: 'Bold' }).click();
        await expect(box).toHaveValue('**loud**');
        await bar.getByRole('button', { name: 'Checklist' }).click();
        await expect(box).toHaveValue('- [ ] **loud**');
        await box.fill('');
      } else {
        await expect(bar).toBeHidden();
      }
      await page.keyboard.type('/');
      await expect(
        page.getByRole('listbox', { name: 'Commands' }),
      ).toBeVisible();
      await expectAccessible(page);
      await page.keyboard.press('Escape');
      await page.keyboard.type(' @');
      await expect(page.getByRole('listbox', { name: 'People' })).toBeVisible();
      await expectAccessible(page);
    });
  });
}

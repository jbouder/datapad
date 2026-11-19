import type { Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectNote,
  fillNote,
  isMobile,
  openLive,
  SEED,
  test,
} from './fixtures';

/** The composer sample on /dev/components, with its live preview. */
async function open(page: Page) {
  await openLive(page, '/dev/components');
  const box = page.getByRole('textbox', { name: 'Composer' });
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
  await expect(box).toHaveAttribute('aria-controls', /.+/);
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
  await kb.press('ControlOrMeta+b');
  await kb.type(' @le');
  const people = page.getByRole('listbox', { name: 'People' });
  await expect(people.getByRole('option')).toHaveText([/^Leia Organa/]);
  await kb.press('Enter');
  await kb.press('Enter');

  await kb.type('/code');
  await kb.press('Enter');
  await kb.type('/not a command');
  await expect(menu).toBeHidden();

  await expectNote(
    box,
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
  await fillNote(box, '');

  await kb.type('Plan');
  await kb.press('ControlOrMeta+Alt+Digit1');
  await expectNote(box, '# Plan');
  await kb.press('ControlOrMeta+Alt+Digit1');
  await expectNote(box, 'Plan');
  await kb.press('ControlOrMeta+Shift+Digit9');
  await expectNote(box, '- [ ] Plan');
  await kb.press('Tab');
  await expect(box).toBeFocused();
  await expectNote(box, '- [ ] Plan');

  await fillNote(box, '');
  await kb.type('gone');
  await kb.press('ControlOrMeta+a');
  await kb.press('ControlOrMeta+Shift+KeyX');
  await expectNote(box, '~~gone~~');
  await kb.press('ControlOrMeta+z');
  await expectNote(box, 'gone');
});

test('/date tomorrow, Esc closes the menu, ⌘Enter submits', async ({
  page,
}) => {
  const { box } = await open(page);
  const kb = page.keyboard;
  await kb.type('/h');
  await kb.press('Escape');
  await expect(page.getByRole('listbox', { name: 'Commands' })).toBeHidden();
  await fillNote(box, '');
  await kb.type('Due /date tomorrow');
  await kb.press('Enter');
  const tomorrow = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  await expectNote(box, `Due ${tomorrow}`);
  await kb.press('ControlOrMeta+Enter');
  await expect(page.locator('output.toast')).toContainText(
    'Would add the note',
  );
  await expectNote(box, '');
});

test('shows a heading, a checklist and a mention formatted, never as Markdown (#376)', async ({
  page,
}) => {
  const { box, preview } = await open(page);
  const kb = page.keyboard;

  // Markdown typed as you go turns into formatting.
  await kb.type('# Supply run');
  await kb.press('Enter');
  await kb.type('- [ ] Thermal capes');
  await kb.press('Enter');
  await kb.type('Ask @lei');
  await expect(
    page.getByRole('listbox', { name: 'People' }).getByRole('option'),
  ).toHaveText([/^Leia Organa/]);
  await kb.press('Enter');
  await kb.type('about **fuel**');

  await expect(box.locator('h3')).toHaveText('Supply run');
  await expect(box.locator('ul[data-type="taskList"] > li')).toHaveCount(2);
  await expect(box.locator('.mention')).toHaveText('@Leia Organa');
  await expect(box.locator('strong')).toHaveText('fuel');
  // No Markdown on screen.
  const shown = (await box.allInnerTexts()).join('\n');
  for (const syntax of ['#', '- [', '[ ]', '**']) {
    expect(shown).not.toContain(syntax);
  }

  // A checkbox ticks, and undo and redo take it back and forth.
  const capes = box.getByRole('checkbox', { name: 'To do: Thermal capes' });
  await capes.check();
  await expect(
    box.getByRole('checkbox', { name: 'Done: Thermal capes' }),
  ).toBeChecked();
  const stored =
    '# Supply run\n- [x] Thermal capes\n- [ ] Ask @Leia Organa about **fuel**';
  await expectNote(box, stored);
  await kb.press('ControlOrMeta+z');
  await expectNote(box, stored.replace('[x]', '[ ]'));
  await kb.press('ControlOrMeta+Shift+z');
  await expectNote(box, stored);

  // Saved, it renders the same.
  await expect(preview.locator('h3')).toHaveText('Supply run');
  await expect(preview.locator('.mention')).toHaveText('@Leia Organa');
  await expectAccessible(page);
});

test('the draft survives leaving and coming back', async ({ page }) => {
  const { box } = await open(page);
  await page.keyboard.type('half a thought');
  await page
    .getByRole('link', { name: 'Today', exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.locator('[data-day-line]')).toBeVisible();
  await page.goBack();
  await expectNote(
    page.getByRole('textbox', { name: 'Composer' }),
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
        await expectNote(box, '**loud**');
        await bar.getByRole('button', { name: 'Checklist' }).click();
        await expectNote(box, '- [ ] **loud**');
        await fillNote(box, '');
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

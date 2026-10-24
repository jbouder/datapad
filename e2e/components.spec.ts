import type { Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  isMobile,
  openLive,
  SEED,
  test,
} from './fixtures';

/** The shared inputs, on the dev-only /dev/components page. */
async function open(page: Page) {
  await openLive(page, '/dev/components');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Components' }),
  ).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test('every component is axe clean, and so is the open panel', async ({
  page,
}) => {
  await open(page);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Open a side panel' }).click();
  await expect(
    page.getByRole('dialog', { name: 'A side panel' }),
  ).toBeVisible();
  await expectAccessible(page);
});

test('pickers are typeahead comboboxes you can drive by keyboard', async ({
  page,
}) => {
  await open(page);
  const project = page.getByRole('combobox', { name: 'Project', exact: true });
  await project.click();
  await project.fill('falc');
  await expect(page.getByRole('option')).toHaveText([
    /Falcon hyperdrive refit/,
  ]);
  await project.press('Enter');
  await expect(project).toHaveValue('Falcon hyperdrive refit');

  // Archived projects are not offered for new things.
  await project.fill('yavin');
  await expect(page.getByRole('option')).toHaveCount(0);
  await project.press('Escape');

  const person = page.getByRole('combobox', { name: 'Assignee' });
  await person.click();
  await person.fill('Lando Calrissian');
  const add = page.getByRole('option', {
    name: 'Add “Lando Calrissian” to People',
  });
  await expect(add).toBeVisible();
  await person.press('Enter');
  await expect(person).toHaveValue('Lando Calrissian');
});

test('the date field reads shorthand and refuses nonsense', async ({
  page,
}) => {
  await open(page);
  const due = page.getByRole('textbox', { name: 'Due' });
  await due.fill('tomorrow');
  await due.press('Enter');
  await expect(due).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByText('Tomorrow', { exact: true })).toBeVisible();

  await due.fill('+2w');
  await due.press('Tab');
  await expect(due).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);

  await due.fill('soonish');
  await due.press('Tab');
  await expect(due).toHaveAttribute('aria-invalid', 'true');
  await expect(
    page.getByText('Try “fri”, “+3d”, “10/31” or 2026-10-31'),
  ).toBeVisible();

  await due.fill('');
  await due.press('Tab');
  await expect(due).not.toHaveAttribute('aria-invalid');
  await expect(page.getByText('Not set')).toBeVisible();
});

test('the calendar popover picks a day', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Choose a date' }).click();
  const grid = page.getByRole('grid');
  await expect(grid).toBeVisible();
  await grid.getByRole('button', { name: /15/ }).first().click();
  await expect(page.getByRole('textbox', { name: 'Due' })).toHaveValue(/-15$/);
});

test('tags: Enter and comma add, Backspace removes', async ({ page }) => {
  await open(page);
  const tags = page.getByRole('combobox', { name: 'Tags' });
  await tags.click();
  await tags.fill('logistics');
  await tags.press('Enter');
  await tags.fill('urgent');
  await tags.press(',');
  const chips = page.locator('[data-slot="combobox-chip"]');
  await expect(chips).toHaveText(['infra', 'logistics', 'urgent']);
  await tags.press('Backspace');
  await expect(chips).toHaveText(['infra', 'logistics']);
});

test('priority is a radio group with arrow keys', async ({ page }) => {
  test.skip(isMobile(page), 'Arrow-key radios are a keyboard concern.');
  await open(page);
  const group = page.getByRole('group', { name: 'Priority' }).first();
  await group.getByRole('radio', { name: 'No priority' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('radio', { name: 'Low' })).toBeChecked();
  await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('radio', { name: 'Medium' })).toBeChecked();
});

test('links: add a row, fill it, remove it', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Add link' }).click();
  await page
    .getByRole('textbox', { name: 'Link 1 URL' })
    .fill('https://example.com');
  await page.getByRole('textbox', { name: 'Link 1 label' }).fill('Plan');
  await expect(page.getByRole('combobox', { name: 'Link 1 type' })).toHaveValue(
    'link',
  );
  await page.getByRole('button', { name: 'Remove link 1' }).click();
  await expect(page.getByText('No links yet.')).toBeVisible();
});

test('quick-add: Enter adds and stays, Esc clears, empty does nothing', async ({
  page,
}) => {
  await open(page);
  const input = page.getByRole('textbox', { name: 'Add a task' });
  await input.press('Enter');
  await expect(page.getByRole('status')).not.toContainText('Would add');
  await input.fill('Polish the medals');
  await input.press('Enter');
  await expect(page.getByText('Would add “Polish the medals”')).toBeVisible();
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await input.fill('Half typed');
  await input.press('Escape');
  await expect(input).toHaveValue('');
});

test('the side panel: focus in, focus back, Esc, and asking when dirty', async ({
  page,
}) => {
  await open(page);
  const opener = page.getByRole('button', { name: 'Open a side panel' });
  await opener.click();
  const panel = page.getByRole('dialog', { name: 'A side panel' });
  const name = panel.getByRole('textbox', { name: 'Name' });
  // Focus lands on the first field.
  await expect(name).toBeFocused();
  // The page behind does not scroll.
  const overflow = await page.evaluate(
    () =>
      getComputedStyle(document.documentElement).overflow +
      getComputedStyle(document.body).overflow,
  );
  expect(overflow).toContain('hidden');

  // Clean: Esc closes and focus goes back to the opener.
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(opener).toBeFocused();

  // Dirty: Esc asks; Keep editing keeps it; Discard closes.
  await opener.click();
  await name.fill('Half a thought');
  await page.keyboard.press('Escape');
  const ask = panel.getByRole('alertdialog', { name: 'Discard your changes?' });
  await expect(ask).toBeVisible();
  await expect(ask.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await ask.getByRole('button', { name: 'Keep editing' }).click();
  await expect(name).toHaveValue('Half a thought');
  await panel.getByRole('button', { name: 'Cancel' }).click();
  await ask.getByRole('button', { name: 'Discard' }).click();
  await expect(panel).toBeHidden();

  // ⌘/Ctrl+Enter submits from anywhere in the panel.
  await opener.click();
  await name.fill('Saved by keyboard');
  await panel.getByRole('radio', { name: 'High' }).focus();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(panel).toBeHidden();
  await expect(page.getByText('Saved “Saved by keyboard”')).toBeVisible();
});

test('the scrim closes a clean panel and asks on a dirty one', async ({
  page,
}) => {
  test.skip(isMobile(page), 'On a phone the panel covers the scrim.');
  await open(page);
  await page.getByRole('button', { name: 'Open a side panel' }).click();
  const panel = page.getByRole('dialog', { name: 'A side panel' });
  await expect(panel).toBeVisible();
  await page.mouse.click(40, 400);
  await expect(panel).toBeHidden();

  await page.getByRole('button', { name: 'Open a side panel' }).click();
  await panel.getByRole('textbox', { name: 'Name' }).fill('Dirty');
  await page.mouse.click(40, 400);
  await expect(
    panel.getByRole('alertdialog', { name: 'Discard your changes?' }),
  ).toBeVisible();
});

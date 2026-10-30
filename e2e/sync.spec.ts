import type { Page, WebSocketRoute } from '@playwright/test';
import { addTask, expect, test } from './fixtures';

const status = (page: Page) => page.locator('[data-status]').first();

/** Load the app and wait for the socket's first snapshot. */
async function openLive(page: Page, path = '/') {
  await page.goto(path);
  await expect(status(page)).toHaveAttribute('data-status', 'live');
}

/** Go to a section from the rail or the tab bar: no reload. */
async function goTo(page: Page, name: 'Focus' | 'Tasks') {
  await page
    .getByRole('link', { name: new RegExp(`^${name}`) })
    .filter({ visible: true })
    .first()
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name, exact: true }),
  ).toBeVisible();
}

/** The Tasks page, where a task added without a date is listed. */
const tasks = (page: Page) => page.getByRole('main');

/**
 * Focus's header: the week's movement. How many were added says each
 * added task arrived, and once.
 */
const added = (page: Page, n: number) =>
  page.getByText(`0 closed this week · ${n} added · 0 overdue`);

/** Wait until the debounced snapshot cache in IndexedDB holds `title`. */
async function cached(page: Page, title: string) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<string>((resolve) => {
            const open = indexedDB.open('keyval-store');
            open.onsuccess = () => {
              const db = open.result;
              if (!db.objectStoreNames.contains('keyval')) return resolve('');
              const get = db
                .transaction('keyval')
                .objectStore('keyval')
                .get('datapad:snapshot');
              get.onsuccess = () => resolve(JSON.stringify(get.result ?? ''));
              get.onerror = () => resolve('');
            };
            open.onerror = () => resolve('');
          }),
      ),
    )
    .toContain(title);
}

test('a task added in one tab appears in another without a reload', async ({
  page,
  context,
}) => {
  await openLive(page);
  const other = await context.newPage();
  await openLive(other, '/tasks');

  await addTask(page, 'Calibrate the shield generator');
  await expect(tasks(other)).toContainText('Calibrate the shield generator');
  await expect(added(page, 1)).toBeVisible();
});

test('offline: reads keep working, writes queue and replay on reconnect', async ({
  page,
}) => {
  let blocked = false;
  let live: WebSocketRoute | null = null;
  await page.routeWebSocket('**/ws', (ws) => {
    if (blocked) {
      ws.close();
      return;
    }
    live = ws;
    ws.connectToServer();
  });

  await openLive(page);
  await addTask(page, 'Feed the tauntauns');
  await expect(status(page)).toContainText('Saved');

  // Kill the socket and keep refusing new ones.
  blocked = true;
  await (live as WebSocketRoute | null)?.close();
  await expect(status(page)).toContainText('Offline');
  await goTo(page, 'Tasks');
  await expect(tasks(page)).toContainText('Feed the tauntauns');

  await goTo(page, 'Focus');
  await addTask(page, 'Patch the hangar roof');
  await expect(added(page, 2)).toBeVisible();
  await expect(status(page)).toContainText('Offline, 1 change waiting');

  // Back: the queued write goes through.
  blocked = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(status(page)).toHaveAttribute('data-status', 'live');
  await expect(status(page)).toContainText('Saved');

  // It reached the server: a fresh load (no cache shortcut) still has it.
  await page.reload();
  await expect(status(page)).toHaveAttribute('data-status', 'live');
  await expect(added(page, 2)).toBeVisible();
  await goTo(page, 'Tasks');
  await expect(tasks(page)).toContainText('Patch the hangar roof');
});

test('offline changes survive a reload and replay once, in order', async ({
  page,
  context,
}) => {
  let blocked = false;
  let live: WebSocketRoute | null = null;
  await page.routeWebSocket('**/ws', (ws) => {
    if (blocked) {
      ws.close();
      return;
    }
    live = ws;
    ws.connectToServer();
  });

  await openLive(page);
  await addTask(page, 'Feed the tauntauns');
  await expect(status(page)).toContainText('Saved');
  await cached(page, 'Feed the tauntauns');

  // Offline: two tasks on Focus, then a note on another page load.
  blocked = true;
  await (live as WebSocketRoute | null)?.close();
  await expect(status(page)).toContainText('Offline');
  await addTask(page, 'Patch the hangar roof');
  await addTask(page, 'Brief the pilots');
  await expect(status(page)).toContainText('Offline, 2 changes waiting');

  await page.goto('/notes?view=list');
  await expect(status(page)).toHaveAttribute('data-status', 'offline');
  await expect(status(page)).toContainText('Offline, 2 changes waiting');
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Add note' })
    .click();
  const write = page.getByRole('dialog', { name: 'New note' });
  const box = write.getByRole('combobox', { name: 'Note' });
  await box.fill('Shield numbers look low');
  await expect(box).toHaveValue('Shield numbers look low');
  await box.press('ControlOrMeta+Enter');
  await expect(write).toBeHidden();
  await expect(
    page
      .getByRole('main')
      .locator('li[data-note-id]')
      .filter({ hasText: 'Shield numbers look low' }),
  ).toBeVisible();
  await expect(status(page)).toContainText('Offline, 3 changes waiting');

  // Close and reopen at once: everything is still there, still waiting
  // (the queue's synchronous copy beats IndexedDB's write).
  await page.reload();
  await expect(status(page)).toContainText('Offline, 3 changes waiting');
  await expect(page.getByText('Shield numbers look low')).toBeVisible();

  // Online again: all three land, each once.
  blocked = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(status(page)).toHaveAttribute('data-status', 'live');
  await expect(status(page)).toContainText('Saved');

  const other = await context.newPage();
  await openLive(other);
  await expect(added(other, 3)).toBeVisible();
  await goTo(other, 'Tasks');
  await expect(tasks(other)).toContainText('Patch the hangar roof');
  await expect(tasks(other)).toContainText('Brief the pilots');
  const exported = await (await other.request.get('/api/export.json')).json();
  const notes = Object.values(
    exported.notes as Record<string, { body: string }>,
  );
  expect(notes.map((n) => n.body)).toEqual(['Shield numbers look low']);
});

test('Refresh reloads the page and keeps changes still waiting', async ({
  page,
}) => {
  let blocked = false;
  let live: WebSocketRoute | null = null;
  await page.routeWebSocket('**/ws', (ws) => {
    if (blocked) {
      ws.close();
      return;
    }
    live = ws;
    ws.connectToServer();
  });

  await openLive(page);
  blocked = true;
  await (live as WebSocketRoute | null)?.close();
  await expect(status(page)).toContainText('Offline');
  await addTask(page, 'Patch the hangar roof');
  await expect(status(page)).toContainText('Offline, 1 change waiting');

  // A marker on the old page tells a real reload from a re-render.
  await page.evaluate(() => {
    (window as unknown as { before?: boolean }).before = true;
  });
  blocked = false;
  let reloaded = page.waitForEvent('load');
  // In the account menu, at every width; the top bar has no button for it.
  await expect(
    page.getByRole('banner').getByRole('button', { name: 'Refresh' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Account and settings' }).click();
  await page.getByRole('menuitem', { name: 'Refresh' }).click();
  await reloaded;
  expect(
    await page.evaluate(
      () => (window as unknown as { before?: boolean }).before,
    ),
  ).toBeUndefined();
  await expect(status(page)).toHaveAttribute('data-status', 'live');
  await expect(status(page)).toContainText('Saved');
  await expect(added(page, 1)).toBeVisible();

  // ⌘K has it too.
  await page.evaluate(() => {
    (window as unknown as { before?: boolean }).before = true;
  });
  await page.getByRole('button', { name: 'Search' }).click();
  reloaded = page.waitForEvent('load');
  await page.getByRole('option', { name: 'Refresh' }).click();
  await reloaded;
  expect(
    await page.evaluate(
      () => (window as unknown as { before?: boolean }).before,
    ),
  ).toBeUndefined();
  await expect(added(page, 1)).toBeVisible();
});

test('first paint on a warm cache shows data before the socket connects', async ({
  page,
}) => {
  await openLive(page);
  await addTask(page, 'Polish the medals');
  await cached(page, 'Polish the medals');

  // No socket at all this time.
  await page.routeWebSocket('**/ws', (ws) => ws.close());
  await page.reload();
  await expect(added(page, 1)).toBeVisible();
  await expect(status(page)).not.toHaveAttribute('data-status', 'live');
});

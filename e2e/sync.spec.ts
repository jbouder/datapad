import type { Page, WebSocketRoute } from '@playwright/test';
import { expect, isMobile, test } from './fixtures';

/** The Focus quick-add. */
async function addTask(page: Page, title: string) {
  const input = page.getByRole('textbox', { name: 'Add a task' });
  await input.fill(title);
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
}

const status = (page: Page) => page.locator('[data-status]').first();

/** Load the app and wait for the socket's first snapshot. */
async function openLive(page: Page) {
  await page.goto('/');
  await expect(status(page)).toHaveAttribute('data-status', 'live');
}

/** Focus's buckets (No date is collapsed, so read text, not roles). */
const openTasks = (page: Page) =>
  page.getByRole('region', { name: 'Open tasks' });

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
  await openLive(other);

  await addTask(page, 'Calibrate the shield generator');
  await expect(openTasks(other)).toContainText(
    'Calibrate the shield generator',
  );
  await expect(other.getByText('0 projects · 1 open task')).toBeVisible();
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
  await expect(openTasks(page)).toContainText('Feed the tauntauns');

  await addTask(page, 'Patch the hangar roof');
  await expect(openTasks(page)).toContainText('Patch the hangar roof');
  await expect(status(page)).toContainText('Offline, 1 change waiting');

  // Back: the queued write goes through.
  blocked = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(status(page)).toHaveAttribute('data-status', 'live');
  await expect(status(page)).toContainText('Saved');

  // It reached the server: a fresh load (no cache shortcut) still has it.
  await page.reload();
  await expect(status(page)).toHaveAttribute('data-status', 'live');
  await expect(openTasks(page)).toContainText('Patch the hangar roof');
  await expect(openTasks(page).locator('[data-task-id]')).toHaveCount(2);
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

  await page.goto('/notes');
  await expect(status(page)).toHaveAttribute('data-status', 'offline');
  await expect(status(page)).toContainText('Offline, 2 changes waiting');
  const box = page.getByRole('combobox', { name: 'New note' });
  await box.fill('Shield numbers look low');
  await expect(box).toHaveValue('Shield numbers look low');
  await box.press('ControlOrMeta+Enter');
  await expect(box).toHaveValue('');
  await expect(
    page.getByRole('article').filter({ hasText: 'Shield numbers look low' }),
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
  await expect(openTasks(other)).toContainText('Patch the hangar roof');
  await expect(openTasks(other)).toContainText('Brief the pilots');
  await expect(openTasks(other).locator('[data-task-id]')).toHaveCount(3);
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
  if (isMobile(page)) {
    // No room in the phone's bar: it is in the account menu.
    await page.getByRole('button', { name: 'Account and settings' }).click();
    await page.getByRole('menuitem', { name: 'Refresh' }).click();
  } else {
    await page.getByRole('button', { name: 'Refresh' }).click();
  }
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { before?: boolean }).before),
    )
    .toBeUndefined();
  await expect(status(page)).toHaveAttribute('data-status', 'live');
  await expect(status(page)).toContainText('Saved');
  await expect(openTasks(page)).toContainText('Patch the hangar roof');

  // ⌘K has it too.
  await page.evaluate(() => {
    (window as unknown as { before?: boolean }).before = true;
  });
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('option', { name: 'Refresh' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { before?: boolean }).before),
    )
    .toBeUndefined();
  await expect(openTasks(page).locator('[data-task-id]')).toHaveCount(1);
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
  await expect(openTasks(page)).toContainText('Polish the medals');
  await expect(status(page)).not.toHaveAttribute('data-status', 'live');
});

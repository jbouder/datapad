import type { Page, WebSocketRoute } from '@playwright/test';
import { expect, test } from './fixtures';

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

const openTasks = (page: Page) =>
  page.getByRole('list', { name: 'Open tasks' });

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
  await expect(openTasks(page).getByRole('listitem')).toHaveCount(2);
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

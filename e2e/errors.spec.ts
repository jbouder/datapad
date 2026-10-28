import type { Page, WebSocketRoute } from '@playwright/test';
import {
  addTask,
  expect,
  expectAccessible,
  expectSaved,
  openLive,
  SEED,
  syncStatus,
  test,
} from './fixtures';

/**
 * What the owner sees when something fails (#58; the table in
 * docs/architecture.md → Failures lists every path and its test). The
 * socket drop and offline queue are in sync.spec.ts, an invalid import in
 * data.spec.ts, a failed summary in summaries.spec.ts and a failed backup
 * in backups.spec.ts.
 */

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

/** Tell a dev-build boundary's `CrashForTests` to throw. */
async function crash(page: Page, where: 'page' | 'app') {
  await page.evaluate(
    (detail) =>
      window.dispatchEvent(new CustomEvent('datapad:crash', { detail })),
    where,
  );
}

test('a refused change says which one and why, and is dropped', async ({
  page,
}) => {
  // Stand in for the object refusing one op, as it does one too large or
  // one that no longer applies; everything else goes through.
  await page.routeWebSocket('**/ws', (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      const text = String(message);
      if (text.includes('Smuggle the spice')) {
        const { opId } = JSON.parse(text) as { opId: string };
        ws.send(
          JSON.stringify({
            type: 'rejected',
            opId,
            reason: 'That change is too large to save',
          }),
        );
        return;
      }
      server.send(message);
    });
  });
  await openLive(page);
  await addTask(page, 'Smuggle the spice');
  await expect(page.locator('output.toast')).toContainText(
    'Not saved: add task “Smuggle the spice”. That change is too large to save',
  );
  await expectSaved(page);
  // Gone from the page (the toast still names it).
  await expect(
    page.locator('#main').getByText('Smuggle the spice'),
  ).toHaveCount(0);
});

test('a call that gets no answer says so in words', async ({ page }) => {
  await openLive(page, '/settings/data');
  await page.route('**/api/export.json', (route) => route.abort('failed'));
  await page.getByRole('button', { name: 'Export' }).click();
  await expect(page.locator('output.toast')).toContainText(
    'Could not reach Datapad. Check the connection and try again.',
  );
});

test('an ended session shows Sign in again, and signing in comes back', async ({
  page,
}) => {
  let signedOut = false;
  let live: WebSocketRoute | null = null;
  await page.routeWebSocket('**/ws', (ws) => {
    if (signedOut) {
      ws.close();
      return;
    }
    live = ws;
    ws.connectToServer();
  });
  // Access answers a lapsed session with a redirect to its login on its
  // own origin; the Worker, in dev, with 401. Either reads as signed out.
  await page.route('**/api/health', (route) =>
    signedOut
      ? route.fulfill({
          status: 302,
          headers: {
            location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login',
          },
        })
      : route.fallback(),
  );
  await openLive(page);

  signedOut = true;
  await (live as WebSocketRoute | null)?.close();
  const heading = page.getByRole('heading', {
    level: 1,
    name: 'Sign in again',
  });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.getByRole('navigation', { name: 'Sections' })).toHaveCount(
    0,
  );
  await expectAccessible(page);

  // Access lets them back in: the reload lands in the app, live.
  signedOut = false;
  await page.getByRole('button', { name: 'Sign in again' }).click();
  await expect(syncStatus(page)).toHaveAttribute('data-status', 'live');
  await expect(heading).toHaveCount(0);
});

/**
 * The socket outlives its Access session (#228). The dev sign-in has no
 * token, so `x-dev-session-seconds` (honoured only by the dev bypass) gives
 * the socket a session that ends this many seconds after it opens; the
 * test waits that out on the real clock.
 */
const SESSION_SECONDS = 3;

/** Open the app on a socket whose session ends after SESSION_SECONDS. */
async function openEnding(page: Page) {
  const sockets: string[] = [];
  page.on('websocket', (ws) => sockets.push(ws.url()));
  await page.setExtraHTTPHeaders({
    'x-dev-session-seconds': String(SESSION_SECONDS),
  });
  await openLive(page);
  // Later sockets get an ordinary session.
  await page.setExtraHTTPHeaders({});
  // The session's clock starts when the socket opens, which is before the
  // app goes live, not when the page started loading: wait it out from
  // here, or a slow load leaves the session still running.
  await page.waitForTimeout(SESSION_SECONDS * 1000 + 250);
  return sockets;
}

test('a socket whose session ended reconnects through Access, and the change is saved', async ({
  page,
}) => {
  const sockets = await openEnding(page);
  expect(sockets).toHaveLength(1);
  // The object closes the socket instead of applying this; the app asks
  // /api/health, which still answers, so it reconnects and sends it again.
  await addTask(page, 'Recalibrate the deflector');
  await expectSaved(page);
  expect(sockets).toHaveLength(2);
  // Stored once, on the object.
  const stored = await (await page.request.get('/api/export.json')).json();
  const titles = Object.values(
    stored.tasks as Record<string, { title: string }>,
  ).map((t) => t.title);
  expect(titles.filter((t) => t === 'Recalibrate the deflector')).toHaveLength(
    1,
  );
});

test('a socket whose session ended shows Sign in again when Access says so', async ({
  page,
}) => {
  // Access answers a lapsed session with a redirect to its login.
  await page.route('**/api/health', (route) =>
    route.fulfill({
      status: 302,
      headers: {
        location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login',
      },
    }),
  );
  await openEnding(page);
  // Any change will do: closing a task on Focus (its checkbox is visually
  // hidden; its label is what gets clicked).
  await page
    .locator('label', {
      has: page.getByRole('checkbox', {
        name: 'Close “Confirm shield generator delivery”',
      }),
    })
    .click();
  const heading = page.getByRole('heading', {
    level: 1,
    name: 'Sign in again',
  });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expectAccessible(page);
});

test('a page that throws can be reloaded, and keeps a note being written', async ({
  page,
}) => {
  await openLive(page, '/dev/components');
  const composer = page.getByRole('combobox', { name: 'Composer' });
  await composer.click();
  await page.keyboard.type('half a thought');

  // The crash is reported to the Worker's log (#236): its message and
  // component stack, never what was being written.
  const reported = page.waitForRequest(
    (r) => r.url().endsWith('/api/client-error') && r.method() === 'POST',
  );
  await crash(page, 'page');
  const report = (await reported).postDataJSON() as Record<string, string>;
  expect(Object.keys(report).sort()).toEqual([
    'componentStack',
    'message',
    'version',
    'where',
  ]);
  expect(report.where).toBe('page');
  expect(report.message).toContain('A page crash a test asked for');
  expect(JSON.stringify(report)).not.toContain('half a thought');
  const heading = page.getByRole('heading', {
    level: 1,
    name: 'This view stopped working',
  });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(composer).toHaveCount(0);
  // Only the page went: the sync status and navigation are still there.
  await expect(syncStatus(page)).toHaveAttribute('data-status', 'live');
  await expectAccessible(page);

  await page.getByRole('button', { name: 'Reload this view' }).click();
  await expect(heading).toHaveCount(0);
  await expect(composer).toHaveValue('half a thought');
});

test('the app that throws offers a reload', async ({ page }) => {
  await openLive(page);
  await crash(page, 'app');
  const heading = page.getByRole('heading', {
    level: 1,
    name: 'Datapad stopped working',
  });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expectAccessible(page);

  await page.getByRole('button', { name: 'Reload Datapad' }).click();
  await expect(syncStatus(page)).toHaveAttribute('data-status', 'live');
  await expect(heading).toHaveCount(0);
});

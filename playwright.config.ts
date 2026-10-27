import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT) || 4318;
const CI = Boolean(process.env.CI);

/**
 * One timezone for the runner (Node, which works out `today()` and builds
 * the seed) and the browser (the app's today): `E2E_TZ`, or UTC as in CI.
 * Set here, before the workers start, so they inherit it. Try a zone a day
 * ahead or behind to shake out date bugs:
 * `E2E_TZ=Pacific/Kiritimati npm run e2e`, `E2E_TZ=Pacific/Pago_Pago …`.
 */
const TZ = process.env.E2E_TZ || 'UTC';
process.env.TZ = TZ;

/**
 * End-to-end tests against the built app under `vite preview`: the Worker
 * and the Durable Object run in workerd (Miniflare) exactly as they would
 * deploy, with public/_headers (and so the CSP) applied, which `vite dev`
 * does not do.
 *
 * Sign-in uses the dev Access bypass: .dev.vars must set DEV_ACCESS_EMAIL
 * and wrangler.jsonc's ACCESS_AUD must be empty (CI writes the file). Each
 * test then signs in as its own address (e2e/fixtures.ts), so each gets an
 * empty Durable Object.
 *
 * Every spec runs twice: desktop Chromium and a phone (Pixel 7, touch).
 * Datapad is used on phones a lot; a view is not done until both pass.
 *
 * Locally a server already listening on the port is reused, so
 * `npm run preview -- --port 4318` in another terminal skips the rebuild.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: CI,
  // The retry is for the trace; a test that only passes on it still fails
  // the run.
  retries: CI ? 1 : 0,
  failOnFlakyTests: CI,
  workers: CI ? 2 : undefined,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    timezoneId: TZ,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    // VITE_DEV_COMPONENTS adds /dev/components (the shared inputs) for the
    // a11y suite; the deployed build never has it.
    command: `VITE_DEV_COMPONENTS=1 npx vite build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});

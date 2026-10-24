import { defineConfig, devices } from '@playwright/test';

const PORT = 4318;
const CI = Boolean(process.env.CI);

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
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});

/**
 * Which build this is (#237): the version from package.json and the
 * commit it was built from, defined at build time by `buildInfo()`
 * (build-info.ts, read by vite.config.ts and vitest.config.ts) for the
 * app and the Worker alike. Settings → Account and Help show them;
 * `GET /api/health` returns them.
 */

declare const __APP_VERSION__: string | undefined;
declare const __APP_COMMIT__: string | undefined;

export const VERSION: string =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/** The short commit SHA, or `unknown` outside a git checkout. */
export const COMMIT: string =
  typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'unknown';

/** How the app writes them: `0.1.0 (a1b2c3d)`. */
export const BUILD_LABEL = `${VERSION} (${COMMIT})`;

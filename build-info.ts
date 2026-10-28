import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * The build's version and commit (#237), as Vite `define`s for the app and
 * the Worker (shared/version.ts). The commit is the checkout's HEAD (in
 * the deploy workflow, the commit CI passed), else CI's `GITHUB_SHA`, else
 * `unknown`.
 */
export function buildInfo(): Record<string, string> {
  const pkg = JSON.parse(
    readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  return {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commit()),
  };
}

function commit(): string {
  try {
    const head = execSync('git rev-parse --short=7 HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    if (head) return head;
  } catch {
    // Not a git checkout (a tarball, say).
  }
  const sha = process.env.GITHUB_SHA?.trim();
  return sha && /^[0-9a-f]{7,40}$/.test(sha) ? sha.slice(0, 7) : 'unknown';
}

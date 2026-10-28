import { describe, expect, it } from 'vitest';

/**
 * Every repository path the agent instructions and the docs cite in
 * backticks exists (#241), so a rename or a deletion cannot leave them
 * pointing at nothing. `docs/audits/` is left out: each audit is a dated
 * snapshot of the repository as it was.
 */

const DOCS = import.meta.glob<string>(
  ['/AGENTS.md', '/CLAUDE.md', '/README.md', '/SECURITY.md', '/docs/*.md'],
  { query: '?raw', import: 'default', eager: true },
);

/** Every file in the repository, by its path from the root (`/src/…`). */
const FILES = Object.keys(
  import.meta.glob([
    '/*',
    '/.github/**/*',
    '/docs/**/*',
    '/e2e/**/*',
    '/public/**/*',
    '/scripts/**/*',
    '/shared/**/*',
    '/src/**/*',
    '/test/**/*',
    '/worker/**/*',
  ]),
);

/** The top-level directories a cited path can start with. */
const ROOTS = new Set(
  FILES.filter((f) => f.indexOf('/', 1) > 0).map((f) =>
    f.slice(1, f.indexOf('/', 1)),
  ),
);

/**
 * Paths cited on purpose that are not in this clone: local files git
 * ignores, what a build writes, and another repository's files.
 */
const NOT_IN_A_CLONE = new Set([
  '.dev.vars',
  'worker-configuration.d.ts',
  // holocron's, which docs/self-hosting.md suggests porting.
  '.github/workflows/preview.yml',
]);

/** The backticked spans outside fenced code blocks. */
function codeSpans(markdown: string): string[] {
  const prose = markdown.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '');
  return Array.from(prose.matchAll(/`([^`\n]+)`/g), (m) => m[1] ?? '');
}

/**
 * The repository path a span names, or null when it is not one: it must
 * start with a top-level directory and hold nothing a path would not.
 * A trailing `:line`, `:line-line` or `#anchor` is dropped.
 */
function repoPath(span: string): string | null {
  const path = span
    .trim()
    .replace(/^\.\//, '')
    .replace(/(#[\w-]*|:\d+(-\d+)?)$/, '');
  if (!/^[\w.@[\]*-]+(\/[\w.@[\]*-]*)+$/.test(path)) return null;
  const first = path.slice(0, path.indexOf('/'));
  return ROOTS.has(first) ? path : null;
}

/**
 * Whether a cited path exists: a file, a folder (ending in `/` or not), a
 * module as it is imported (`shared/ids`, without `.ts`) or a glob.
 */
function exists(path: string): boolean {
  if (NOT_IN_A_CLONE.has(path)) return true;
  const wanted = `/${path.replace(/\/$/, '')}`;
  if (path.includes('*')) {
    const pattern = new RegExp(
      `^${wanted
        .split('*')
        .map((part) => part.replace(/[.[\]\\^$+?(){}|]/g, '\\$&'))
        .join('[^/]*')}$`,
    );
    return FILES.some((f) => pattern.test(f));
  }
  return FILES.some(
    (f) =>
      f === wanted ||
      f.startsWith(`${wanted}/`) ||
      f === `${wanted}.ts` ||
      f === `${wanted}.tsx`,
  );
}

describe('paths cited in the docs', () => {
  it('finds the files to check', () => {
    expect(Object.keys(DOCS)).toContain('/AGENTS.md');
    expect(Object.keys(DOCS)).toContain('/docs/security.md');
    expect(FILES).toContain('/shared/reducer.ts');
    expect(FILES).toContain('/.github/workflows/ci.yml');
    expect(ROOTS.has('worker')).toBe(true);
  });

  it('reads a span as a path only when it is one', () => {
    expect(repoPath('shared/types.ts')).toBe('shared/types.ts');
    expect(repoPath('src/components/layouts/')).toBe('src/components/layouts/');
    expect(repoPath('index.html:27')).toBeNull();
    expect(repoPath('docs/self-hosting.md:225-230')).toBe(
      'docs/self-hosting.md',
    );
    expect(repoPath('src/lib/summary-*.ts')).toBe('src/lib/summary-*.ts');
    for (const span of [
      '/api/spaces',
      'npm run check',
      'lib/router.ts',
      '<email>/<id>/',
      'https://github.com/jbouder/datapad',
      'datapad:snapshot',
    ]) {
      expect(repoPath(span), span).toBeNull();
    }
  });

  for (const [file, text] of Object.entries(DOCS)) {
    it(`${file.slice(1)} cites only paths that exist`, () => {
      const missing = codeSpans(text)
        .map(repoPath)
        .filter((p): p is string => p !== null && !exists(p));
      expect(missing).toEqual([]);
    });
  }
});

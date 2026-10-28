import { describe, expect, it } from 'vitest';

/*
 * Every action the workflows use is pinned to a full commit SHA. A tag such
 * as `@v4` can be moved to different code by whoever controls the action's
 * repository; a SHA cannot. The trailing `# vX.Y.Z` comment is what
 * Dependabot reads and rewrites, so an update stays one reviewable pull
 * request that changes the SHA and the comment together. (After holotable's
 * test/workflow-pins.test.ts.)
 */

// Read at build time: the tests run in workerd, which has no file system.
const WORKFLOWS = import.meta.glob<string>(
  '../.github/workflows/*.{yml,yaml}',
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
);

const PINNED = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/;

function usesLines(): { file: string; line: number; ref: string }[] {
  return Object.entries(WORKFLOWS).flatMap(([file, text]) =>
    text.split('\n').flatMap((line, i) => {
      const match = /^\s*(?:-\s+)?uses:\s*(.+?)\s*$/.exec(line);
      return match?.[1]
        ? [{ file: file.replace(/^\.\.\//, ''), line: i + 1, ref: match[1] }]
        : [];
    }),
  );
}

describe('workflows', () => {
  it('are found, and use actions', () => {
    expect(Object.keys(WORKFLOWS)).toEqual(
      expect.arrayContaining([
        '../.github/workflows/ci.yml',
        '../.github/workflows/codeql.yml',
        '../.github/workflows/deploy.yml',
      ]),
    );
    expect(usesLines().length).toBeGreaterThan(0);
  });

  it('pin every action to a commit SHA with its version in a comment', () => {
    const unpinned = usesLines()
      .filter(({ ref }) => !ref.startsWith('./') && !PINNED.test(ref))
      .map(({ file, line, ref }) => `${file}:${line} ${ref}`);
    expect(
      unpinned,
      'pin each to `owner/repo@<40-hex sha> # vX.Y.Z` (resolve the tag with `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`)',
    ).toEqual([]);
  });

  it('pin one action to one version everywhere it is used', () => {
    const pins = new Map<string, Set<string>>();
    for (const { ref } of usesLines()) {
      // `github/codeql-action/init` and `/analyze` are one action.
      const [path = '', pin] = ref.split('@');
      if (!pin) continue;
      const action = path.split('/').slice(0, 2).join('/');
      pins.set(action, (pins.get(action) ?? new Set()).add(pin));
    }
    const split = [...pins].filter(([, p]) => p.size > 1).map(([a]) => a);
    expect(split, 'every use of an action carries the same pin').toEqual([]);
  });

  it('never use pull_request_target', () => {
    // It runs fork PRs with a write token and the repository's secrets.
    const offenders = Object.entries(WORKFLOWS)
      .filter(([, text]) => /^\s*pull_request_target\s*:/m.test(text))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});

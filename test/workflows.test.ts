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

const PACKAGE = JSON.parse(
  Object.values(
    import.meta.glob<string>('../package.json', {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
  )[0] ?? '{}',
) as {
  packageManager?: string;
  devDependencies?: Record<string, string>;
};

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

  it('use the one bun version package.json names', () => {
    // `packageManager` is the version: setup-bun reads it through
    // `bun-version-file`, and the e2e container installs exactly it.
    expect(PACKAGE.packageManager).toMatch(/^bun@\d+\.\d+\.\d+$/);
    const offenders: string[] = [];
    for (const [file, text] of Object.entries(WORKFLOWS)) {
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        const where = `${file.replace(/^\.\.\//, '')}:${i + 1}`;
        if (/uses:\s*oven-sh\/setup-bun@/.test(line)) {
          // The step's own `with:` block: the lines indented past `uses:`.
          const indent = line.search(/\S/) + 2;
          const block: string[] = [];
          for (const next of lines.slice(i + 1)) {
            if (next.trim() && next.search(/\S/) < indent) break;
            block.push(next);
          }
          const step = block.join('\n');
          if (
            !/^\s*bun-version-file:\s*package\.json\s*$/m.test(step) ||
            /^\s*bun-version:/m.test(step)
          ) {
            offenders.push(`${where} setup-bun without bun-version-file`);
          }
        }
        if (
          /install\s+(?:--global|-g)\s+["']?bun\b/.test(line) &&
          !line.includes('packageManager')
        ) {
          offenders.push(`${where} installs bun without packageManager`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('pin the Playwright image by digest, at the @playwright/test version', () => {
    const images = Object.values(WORKFLOWS).flatMap((text) =>
      [...text.matchAll(/^\s*image:\s*(.+?)\s*$/gm)].map((m) => m[1] ?? ''),
    );
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      // A tag can be pushed again; a digest cannot. The comment keeps the
      // tag, so a reader (and the check below) knows which one it is.
      expect(image).toMatch(/^[\w./-]+@sha256:[0-9a-f]{64} # \S+$/);
    }
    const playwright = images.find((i) =>
      i.startsWith('mcr.microsoft.com/playwright@'),
    );
    expect(
      playwright,
      'the e2e job runs in the Playwright image',
    ).toBeDefined();
    const version = PACKAGE.devDependencies?.['@playwright/test'];
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(playwright).toMatch(new RegExp(` # v${version}-\\w+$`));
  });

  it('never use pull_request_target', () => {
    // It runs fork PRs with a write token and the repository's secrets.
    const offenders = Object.entries(WORKFLOWS)
      .filter(([, text]) => /^\s*pull_request_target\s*:/m.test(text))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});

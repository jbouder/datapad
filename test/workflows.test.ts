import { describe, expect, it } from 'vitest';
import { deployProblems, stripJsonc } from '../scripts/deploy-config';
import wrangler from '../wrangler.jsonc?raw';

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

describe('the deploy (#232)', () => {
  const deploy = WORKFLOWS['../.github/workflows/deploy.yml'] ?? '';

  it('checks Access is configured before it builds or deploys', () => {
    const check = deploy.indexOf('run: bun scripts/check-deploy.ts');
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(deploy.indexOf('run: bun run build'));
    expect(check).toBeLessThan(deploy.indexOf('cloudflare/wrangler-action'));
  });

  it('passes the wrangler.jsonc in this repository', () => {
    expect(deployProblems(wrangler)).toEqual([]);
  });

  it('fails an empty ACCESS_AUD or team domain, and a DEV_ACCESS_EMAIL', () => {
    const config = (vars: Record<string, string>) => `{
      // A comment, and "// not one" inside a string.
      "name": "datapad // here",
      /* a block */
      "vars": ${JSON.stringify(vars)},
    }`;
    const good = {
      ACCESS_TEAM_DOMAIN: 'rebels.cloudflareaccess.com',
      ACCESS_AUD: 'aud',
    };
    expect(deployProblems(config(good))).toEqual([]);
    expect(deployProblems(config({ ...good, ACCESS_AUD: ' ' }))).toEqual([
      expect.stringContaining('vars.ACCESS_AUD is empty'),
    ]);
    expect(deployProblems(config({ ...good, ACCESS_TEAM_DOMAIN: '' }))).toEqual(
      [expect.stringContaining('vars.ACCESS_TEAM_DOMAIN is empty')],
    );
    expect(
      deployProblems(config({ ...good, DEV_ACCESS_EMAIL: 'dev@example.com' })),
    ).toEqual([expect.stringContaining('DEV_ACCESS_EMAIL is set')]);
    expect(deployProblems('{ "vars": {} }')).toHaveLength(2);
    expect(deployProblems('{ not json')).toEqual([
      'wrangler.jsonc is not valid JSONC',
    ]);
  });

  it('checks every environment, staging included (#327)', () => {
    const vars = {
      ACCESS_TEAM_DOMAIN: 'rebels.cloudflareaccess.com',
      ACCESS_AUD: 'aud',
    };
    const config = (staging: Record<string, string>) =>
      JSON.stringify({ vars, env: { staging: { vars: staging } } });
    expect(deployProblems(config(vars))).toEqual([]);
    expect(deployProblems(config({ ...vars, ACCESS_AUD: '' }))).toEqual([
      expect.stringContaining('env.staging.vars.ACCESS_AUD is empty'),
    ]);
    expect(
      deployProblems(config({ ...vars, DEV_ACCESS_EMAIL: 'dev@example.com' })),
    ).toEqual([
      expect.stringContaining('env.staging.vars.DEV_ACCESS_EMAIL is set'),
    ]);
  });

  it('strips JSONC without touching strings', () => {
    expect(
      JSON.parse(stripJsonc('{"a": "x//y", /* c */ "b": [1, 2,], // d\n}')),
    ).toEqual({ a: 'x//y', b: [1, 2] });
  });
});

interface Env {
  name?: string;
  durable_objects?: { bindings: { name: string; class_name: string }[] };
  r2_buckets?: { binding: string; bucket_name: string }[];
  kv_namespaces?: { binding: string; id?: string }[];
  ratelimits?: { name: string; namespace_id: string }[];
  vars?: Record<string, string>;
}

describe('staging (#327)', () => {
  const config = JSON.parse(stripJsonc(wrangler)) as Env & {
    env?: Record<string, Env>;
  };
  const staging = config.env?.staging ?? {};
  const deploy = WORKFLOWS['../.github/workflows/deploy.yml'] ?? '';

  it('is its own Worker, so its own Durable Object namespace', () => {
    expect(staging.name).toBe('datapad-v2');
    expect(staging.name).not.toBe(config.name);
    expect(staging.durable_objects).toEqual(config.durable_objects);
  });

  it('shares no bucket, KV namespace, rate limiter or Access app', () => {
    const bucket = (e: Env) =>
      e.r2_buckets?.find((b) => b.binding === 'BACKUPS')?.bucket_name;
    expect(bucket(staging)).toBe('datapad-v2-backups');
    expect(bucket(staging)).not.toBe(bucket(config));

    const kv = (e: Env) =>
      e.kv_namespaces?.find((k) => k.binding === 'OAUTH_KV');
    expect(kv(staging)).toBeDefined();
    // No id lets the first deploy create the Worker's own namespace; an id
    // must not be production's.
    const id = kv(staging)?.id;
    if (id) expect(id).not.toBe(kv(config)?.id);

    const limit = (e: Env) =>
      e.ratelimits?.find((r) => r.name === 'REGISTER_LIMIT')?.namespace_id;
    expect(limit(staging)).toBeDefined();
    expect(limit(staging)).not.toBe(limit(config));

    expect(staging.vars?.ACCESS_AUD).toBeTruthy();
    expect(staging.vars?.ACCESS_AUD).not.toBe(config.vars?.ACCESS_AUD);
    expect(Object.keys(staging.vars ?? {}).sort()).toEqual(
      Object.keys(config.vars ?? {}).sort(),
    );
  });

  it('deploys from v2, and main still to production', () => {
    expect(deploy).toMatch(/branches: \[main, v2\]/);
    expect(deploy).toMatch(/main\)\s+echo "environment=production"/);
    expect(deploy).toMatch(
      /v2\)\s+echo "environment=staging"[^;]*cloudflare_env=staging/,
    );
    expect(deploy).toContain(
      'CLOUDFLARE_ENV: ${{ needs.gate.outputs.cloudflare_env }}',
    );
    for (const file of ['ci.yml', 'codeql.yml']) {
      expect(WORKFLOWS[`../.github/workflows/${file}`]).toMatch(
        /push:\s+branches: \[main, v2\]/,
      );
    }
  });
});

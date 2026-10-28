/**
 * What the deploy workflow checks in wrangler.jsonc before it ships (#232),
 * pure so test/workflows.test.ts can run it: Access must be configured, and
 * the dev bypass must not be. With `ACCESS_AUD` empty the Worker refuses
 * everything (worker/access.ts), so a deploy like that is a broken app at
 * best; this makes it a failed deploy instead.
 */

/** JSONC to JSON: comments and trailing commas out, strings untouched. */
export function stripJsonc(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

interface WranglerConfig {
  vars?: Record<string, unknown>;
  env?: Record<string, { vars?: Record<string, unknown> }>;
}

/** Every problem with `wrangler.jsonc`'s text for a deploy; none is ready. */
export function deployProblems(text: string): string[] {
  let config: WranglerConfig;
  try {
    config = JSON.parse(stripJsonc(text)) as WranglerConfig;
  } catch {
    return ['wrangler.jsonc is not valid JSONC'];
  }
  const problems: string[] = [];
  const sets: [string, Record<string, unknown> | undefined][] = [
    ['vars', config.vars],
    ...Object.entries(config.env ?? {}).map(
      ([name, e]) =>
        [`env.${name}.vars`, e.vars] as [string, Record<string, unknown>],
    ),
  ];
  for (const [where, vars] of sets) {
    const value = (name: string) =>
      typeof vars?.[name] === 'string' ? (vars[name] as string).trim() : '';
    if (!value('ACCESS_AUD')) {
      problems.push(
        `${where}.ACCESS_AUD is empty: set it to the Access application's audience tag (docs/self-hosting.md)`,
      );
    }
    if (!value('ACCESS_TEAM_DOMAIN')) {
      problems.push(
        `${where}.ACCESS_TEAM_DOMAIN is empty: set it to <team>.cloudflareaccess.com`,
      );
    }
    if (vars && 'DEV_ACCESS_EMAIL' in vars) {
      problems.push(
        `${where}.DEV_ACCESS_EMAIL is set: it belongs in .dev.vars only, never in a deployment`,
      );
    }
  }
  return problems;
}

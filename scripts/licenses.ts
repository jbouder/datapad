/**
 * The license allowlist: every package `bun install` put in node_modules
 * (dependencies, dev dependencies, and everything they pull in) must carry
 * a license from ALLOWED, or be listed in EXCEPTIONS with the reason. CI's
 * `check` job runs it after the install:
 *
 *   npm run licenses
 *
 * An SPDX expression passes when one side of each `OR` is allowed and both
 * sides of each `AND` are. A package with no license field fails. Add to
 * ALLOWED only a permissive license; anything else is an exception, by
 * name, with why it is acceptable here.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ALLOWED = new Set([
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'ISC',
  'MIT',
  // File-level copyleft: using the files unmodified asks nothing of us.
  // lightningcss (Tailwind's CSS build) and axe-core (the e2e checks).
  'MPL-2.0',
  // The bundled fonts (@fontsource-variable/*): free to embed and serve.
  'OFL-1.1',
  // caniuse-lite: browser support data, attribution in its own package.
  'CC-BY-4.0',
]);

/** Packages (or a name prefix ending in `*`) allowed anyway, and why. */
const EXCEPTIONS: Record<string, string> = {
  // sharp's prebuilt libvips binary for the build machine's platform, from
  // wrangler's local tooling. Dynamically linked, never bundled or
  // deployed: nothing of it reaches the Worker or the browser.
  '@img/sharp-libvips-*': 'LGPL-3.0-or-later, build tooling only',
};

const NODE_MODULES = resolve(import.meta.dirname, '..', 'node_modules');

interface Found {
  name: string;
  version: string;
  license: string | undefined;
  path: string;
}

function licenseOf(pkg: Record<string, unknown>): string | undefined {
  const field = pkg.license ?? pkg.licenses;
  if (typeof field === 'string') return field;
  if (field && typeof field === 'object' && 'type' in field) {
    return String((field as { type: unknown }).type);
  }
  if (Array.isArray(field)) {
    return field
      .map((l) => (typeof l === 'string' ? l : String(l?.type)))
      .join(' OR ');
  }
  return undefined;
}

function walk(dir: string, out: Found[]) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const path = join(dir, entry);
    if (entry.startsWith('@')) {
      walk(path, out);
      continue;
    }
    const manifest = join(path, 'package.json');
    if (!existsSync(manifest)) continue;
    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    } catch {
      continue;
    }
    if (typeof pkg.name === 'string') {
      out.push({
        name: pkg.name,
        version: String(pkg.version ?? ''),
        license: licenseOf(pkg),
        path,
      });
    }
    walk(join(path, 'node_modules'), out);
  }
}

/** Whether an SPDX expression is satisfied by the allowlist. */
function allowed(expression: string): boolean {
  const text = expression.trim();
  // Parentheses around the whole expression, or around one group.
  const inner = text.replace(/^\((.*)\)$/, '$1');
  if (inner !== text) return allowed(inner);
  const anyOf = splitTop(text, 'OR');
  if (anyOf.length > 1) return anyOf.some(allowed);
  const allOf = splitTop(text, 'AND');
  if (allOf.length > 1) return allOf.every(allowed);
  return ALLOWED.has(text);
}

/** Split on ` OP ` outside parentheses. */
function splitTop(text: string, op: 'OR' | 'AND'): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  const token = ` ${op} `;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    else if (depth === 0 && text.startsWith(token, i)) {
      parts.push(text.slice(start, i));
      start = i + token.length;
      i += token.length - 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function excepted(name: string): boolean {
  return Object.keys(EXCEPTIONS).some((pattern) =>
    pattern.endsWith('*')
      ? name.startsWith(pattern.slice(0, -1))
      : name === pattern,
  );
}

const found: Found[] = [];
walk(NODE_MODULES, found);
if (found.length === 0) {
  console.error('licenses: nothing in node_modules; run `bun install` first');
  process.exit(1);
}

const failures = found.filter(
  (p) => !excepted(p.name) && !(p.license && allowed(p.license)),
);
if (failures.length) {
  for (const p of failures) {
    console.error(
      `licenses: ${p.name}@${p.version} is ${p.license ?? 'unlicensed (no license field)'}`,
    );
  }
  console.error(
    'Allow the license in scripts/licenses.ts only if it is permissive; otherwise add the package to EXCEPTIONS with the reason.',
  );
  process.exit(1);
}
const names = new Set(found.map((p) => p.name)).size;
console.log(`licenses: ok, ${names} packages`);

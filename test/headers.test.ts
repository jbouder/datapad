import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import html from '../index.html?raw';
import headers from '../public/_headers?raw';
import type { Bindings } from '../worker/env';
import { createHandler } from '../worker/index';
import { consentPage, problemPage } from '../worker/mcp/consent';

/** The header lines under one path rule of public/_headers, by name. */
function rule(path: string): Map<string, string> {
  const out = new Map<string, string>();
  let inside = false;
  for (const line of headers.split('\n')) {
    if (line === '' || line.startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      inside = line.trim() === path;
      continue;
    }
    if (!inside) continue;
    const at = line.indexOf(':');
    out.set(line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim());
  }
  return out;
}

const HSTS = 'max-age=31536000; includeSubDomains';

/** The value of one header in public/_headers (named once in the file). */
function header(name: string): string {
  const lines = headers
    .split('\n')
    .filter((l) => l.trim().toLowerCase().startsWith(`${name.toLowerCase()}:`));
  expect(lines, `${name} in public/_headers`).toHaveLength(1);
  const line = lines[0] ?? '';
  return line.slice(line.indexOf(':') + 1).trim();
}

function directive(csp: string, name: string): string[] {
  const found = csp
    .split(';')
    .map((d) => d.trim().split(/\s+/))
    .find(([key]) => key === name);
  expect(found, `${name} in the CSP`).toBeDefined();
  return found?.slice(1) ?? [];
}

/** The body of every inline `<script>` (no `src`), parsed rather than matched. */
async function inlineScripts(source: string): Promise<string[]> {
  const bodies: string[] = [];
  await new HTMLRewriter()
    .on('script:not([src])', {
      element() {
        bodies.push('');
      },
      text(chunk) {
        bodies[bodies.length - 1] += chunk.text;
      },
    })
    .transform(new Response(source))
    .text();
  return bodies;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

describe('static asset headers', () => {
  it('is a well-formed _headers file', () => {
    // Comments, blank lines, one path rule, and `Name: value` lines. Anything
    // else (a stray conflict marker, say) ships to every visitor.
    for (const line of headers.split('\n')) {
      if (line === '' || line.startsWith('#')) continue;
      expect(line, line).toMatch(/^(\/\S*|\s+[A-Za-z-]+: \S.*)$/);
    }
  });

  const csp = header('Content-Security-Policy');

  it('allows every inline script in index.html by hash, and nothing else inline', async () => {
    const inline = await inlineScripts(html);
    expect(inline.length).toBeGreaterThan(0);
    const scriptSrc = directive(csp, 'script-src');
    for (const body of inline) {
      expect(scriptSrc).toContain(`'sha256-${await sha256(body)}'`);
    }
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it('cannot be framed, sniffed or pointed elsewhere', () => {
    expect(directive(csp, 'default-src')).toEqual(["'self'"]);
    expect(directive(csp, 'frame-ancestors')).toEqual(["'none'"]);
    expect(directive(csp, 'object-src')).toEqual(["'none'"]);
    expect(directive(csp, 'base-uri')).toEqual(["'none'"]);
    expect(directive(csp, 'form-action')).toEqual(["'self'"]);
    expect(header('X-Content-Type-Options')).toBe('nosniff');
    expect(header('X-Frame-Options')).toBe('DENY');
    expect(header('Referrer-Policy')).toBe('same-origin');
    expect(header('Permissions-Policy')).toContain('camera=()');
  });

  it('sends HSTS on every asset (#233)', () => {
    expect(rule('/*').get('strict-transport-security')).toBe(HSTS);
  });

  it('keeps hashed /assets/* for a year, privately (#233)', () => {
    expect(rule('/assets/*').get('cache-control')).toBe(
      'private, max-age=31536000, immutable',
    );
    // Only there: index.html and the icons are revalidated.
    expect(rule('/*').has('cache-control')).toBe(false);
  });

  it('loads nothing from another origin', () => {
    for (const name of ['script-src', 'font-src', 'img-src', 'worker-src']) {
      for (const source of directive(csp, name)) {
        expect(source, `${name} ${source}`).not.toMatch(/^https?:|^\*/);
      }
    }
  });

  it('connects elsewhere only for the summary model, as holocron does', () => {
    expect(directive(csp, 'connect-src')).toEqual([
      "'self'",
      // The weights, and the CDNs Hugging Face redirects them to.
      'https://huggingface.co',
      'https://*.huggingface.co',
      'https://*.hf.co',
      // WebLLM's WebGPU model library.
      'https://raw.githubusercontent.com',
    ]);
    // WebAssembly for the model, and still no eval.
    expect(directive(csp, 'script-src')).toContain("'wasm-unsafe-eval'");
    expect(directive(csp, 'worker-src')).toEqual(["'self'"]);
  });
});

describe('Worker response headers', () => {
  const signedIn = createHandler(async () => ({ email: 'leia@example.com' }));
  const signedOut = createHandler(async () => null);
  const bindings = env as unknown as Bindings;

  it('sends them on JSON, error and refusal responses', async () => {
    const responses = await Promise.all([
      signedIn(new Request('http://datapad.test/api/config'), bindings),
      signedIn(new Request('http://datapad.test/api/nope'), bindings),
      signedIn(new Request('http://datapad.test/ws'), bindings),
      signedOut(new Request('http://datapad.test/'), bindings),
      signedOut(new Request('http://datapad.test/api/config'), bindings),
      signedOut(new Request('http://datapad.test/ws'), bindings),
    ]);
    for (const response of responses) {
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('strict-transport-security')).toBe(HSTS);
      expect(response.headers.get('x-request-id')).toBeTruthy();
      expect(response.headers.get('content-security-policy')).toContain(
        "frame-ancestors 'none'",
      );
    }
  });
});

/** Every inline `<style>` body, parsed. */
async function inlineStyles(source: string): Promise<string[]> {
  const bodies: string[] = [];
  await new HTMLRewriter()
    .on('style', {
      element() {
        bodies.push('');
      },
      text(chunk) {
        bodies[bodies.length - 1] += chunk.text;
      },
    })
    .transform(new Response(source))
    .text();
  return bodies;
}

describe('the MCP consent page (#152)', () => {
  const details = {
    clientId: 'c1',
    clientName: 'Claude Code',
    redirectUri: 'http://localhost:43123/callback',
    redirectHost: 'localhost',
    redirectIsLoopback: true,
    scope: [],
  };

  it('runs no script, allows its one style by hash, and cannot be framed', async () => {
    const pages = [
      await consentPage(details, 'handle-1', 'leia@example.com', new Headers()),
      await problemPage('Expired.'),
    ];
    for (const page of pages) {
      const html = await page.text();
      expect(await inlineScripts(html)).toEqual([]);
      expect(html).not.toMatch(/\son[a-z]+=/i);
      const csp = page.headers.get('content-security-policy') ?? '';
      expect(directive(csp, 'default-src')).toEqual(["'none'"]);
      expect(directive(csp, 'frame-ancestors')).toEqual(["'none'"]);
      expect(directive(csp, 'base-uri')).toEqual(["'none'"]);
      expect(csp).not.toContain('script-src');
      const styles = await inlineStyles(html);
      expect(styles).toHaveLength(1);
      expect(directive(csp, 'style-src')).toEqual([
        `'sha256-${await sha256(styles[0] ?? '')}'`,
      ]);
      expect(page.headers.get('x-content-type-options')).toBe('nosniff');
      expect(page.headers.get('x-frame-options')).toBe('DENY');
      expect(page.headers.get('cache-control')).toBe('no-store');
      expect(page.headers.get('referrer-policy')).toBe('no-referrer');
      expect(page.headers.get('strict-transport-security')).toBe(HSTS);
    }
  });

  it('posts its form only here, and to the client the redirect goes to', async () => {
    const page = await consentPage(
      details,
      'h',
      'leia@example.com',
      new Headers(),
    );
    const csp = page.headers.get('content-security-policy') ?? '';
    expect(directive(csp, 'form-action')).toEqual([
      "'self'",
      'http://localhost:43123',
    ]);
    const odd = await consentPage(
      { ...details, redirectUri: 'com.example.app:/cb' },
      'h',
      'leia@example.com',
      new Headers(),
    );
    expect(
      directive(
        odd.headers.get('content-security-policy') ?? '',
        'form-action',
      ),
    ).toEqual(["'self'"]);
  });
});

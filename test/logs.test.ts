import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLIENT_ERROR_BYTES } from '#shared/protocol';
import type { Bindings } from '../worker/env';
import { createHandler } from '../worker/index';
import { REQUEST_ID_HEADER } from '../worker/log';
import fixture from './fixtures/export.json';

/**
 * The Worker's request ids, client error reports and security log lines
 * (#236). Every line is one JSON object; none carries an email, a token or
 * a confirmation (docs/architecture.md#logs).
 */

const bindings = env as unknown as Bindings;
const ORIGIN = 'http://datapad.test';

function as(email: string | null) {
  return createHandler(async () => (email ? { email } : null));
}

/** The keys a security line may have, and nothing else. */
const SECURITY_KEYS = new Set([
  'level',
  'what',
  'event',
  'requestId',
  'outcome',
  'space',
  'clientId',
  'grantId',
  'scope',
  'imported',
]);

let lines: { level: string; text: string; json: Record<string, unknown> }[];
const originals = { log: console.log, error: console.error };

beforeEach(() => {
  lines = [];
  for (const level of ['log', 'error'] as const) {
    console[level] = (...args: unknown[]) => {
      const text = String(args[0]);
      try {
        lines.push({ level, text, json: JSON.parse(text) });
      } catch {
        originals[level](...args);
      }
    };
  }
});

afterEach(() => {
  console.log = originals.log;
  console.error = originals.error;
});

function security(event: string) {
  return lines.filter((l) => l.json.event === event).map((l) => l.json);
}

function post(email: string, path: string, body: unknown, headers = {}) {
  return as(email)(
    new Request(`${ORIGIN}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    bindings,
  );
}

async function eraseToken(email: string, space?: string): Promise<string> {
  const query = space ? `?space=${space}` : '';
  const response = await as(email)(
    new Request(`${ORIGIN}/api/erase-token${query}`),
    bindings,
  );
  return ((await response.json()) as { token: string }).token;
}

describe('request ids', () => {
  it('names every response by its cf-ray, signed in or not', async () => {
    for (const handle of [as('leia@example.com'), as(null)]) {
      for (const path of ['/api/config', '/api/nope', '/ws', '/']) {
        const response = await handle(
          new Request(`${ORIGIN}${path}`, {
            headers: { 'cf-ray': '8f00aa11bb22cc33-IAD' },
          }),
          bindings,
        );
        expect(response.headers.get(REQUEST_ID_HEADER), path).toBe(
          '8f00aa11bb22cc33-IAD',
        );
      }
    }
  });

  it('makes one up locally, and never echoes a malformed ray', async () => {
    const response = await as('leia@example.com')(
      new Request(`${ORIGIN}/api/config`, {
        headers: { 'cf-ray': '<script>' },
      }),
      bindings,
    );
    expect(response.headers.get(REQUEST_ID_HEADER)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('puts the id in a 500’s body and its log line', async () => {
    const broken = {
      ...bindings,
      DATAPAD: {
        getByName: () => ({
          listSpaces: () => Promise.reject(new Error('disk on fire')),
        }),
      },
    } as unknown as Bindings;
    const response = await as('leia@example.com')(
      new Request(`${ORIGIN}/api/spaces`, {
        headers: { 'cf-ray': 'ray-500' },
      }),
      broken,
    );
    expect(response.status).toBe(500);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe('ray-500');
    expect(await response.json()).toEqual({
      error: 'Something went wrong',
      requestId: 'ray-500',
    });
    expect(lines.map((l) => l.json)).toContainEqual({
      level: 'error',
      path: '/api/spaces',
      requestId: 'ray-500',
      error: 'disk on fire',
    });
    expect(lines.map((l) => l.text).join('\n')).not.toContain('leia@');
  });
});

describe('POST /api/client-error', () => {
  const report = {
    where: 'page',
    message: 'TypeError: x is undefined',
    componentStack: '\n    at TaskRow\n    at TasksPage',
    version: '0.1.0 (a1b2c3d)',
  };

  it('logs the message and component stack, and answers 204', async () => {
    const response = await post(
      'leia@example.com',
      '/api/client-error',
      report,
      {
        'cf-ray': 'ray-client',
      },
    );
    expect(response.status).toBe(204);
    expect(lines.map((l) => l.json)).toEqual([
      {
        level: 'error',
        what: 'client',
        requestId: 'ray-client',
        ...report,
      },
    ]);
  });

  it('takes nothing else: extra fields are dropped, long ones refused', async () => {
    const response = await post('leia@example.com', '/api/client-error', {
      ...report,
      state: { notes: ['the plans are in R2-D2'] },
    });
    expect(response.status).toBe(204);
    expect(lines.map((l) => l.text).join('\n')).not.toContain('R2-D2');
    const long = await post('leia@example.com', '/api/client-error', {
      ...report,
      message: 'x'.repeat(501),
    });
    expect(long.status).toBe(400);
  });

  it('is size-capped, same-site, JSON, POST and behind Access', async () => {
    const big = await post(
      'leia@example.com',
      '/api/client-error',
      'x'.repeat(CLIENT_ERROR_BYTES + 1),
    );
    expect(big.status).toBe(413);
    const cross = await post('leia@example.com', '/api/client-error', report, {
      origin: 'https://evil.example',
    });
    expect(cross.status).toBe(403);
    const form = await post('leia@example.com', '/api/client-error', report, {
      'content-type': 'text/plain',
    });
    expect(form.status).toBe(415);
    const get = await as('leia@example.com')(
      new Request(`${ORIGIN}/api/client-error`),
      bindings,
    );
    expect(get.status).toBe(405);
    const signedOut = await as(null)(
      new Request(`${ORIGIN}/api/client-error`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(report),
      }),
      bindings,
    );
    expect(signedOut.status).toBe(401);
  });
});

describe('security events', () => {
  it('logs erase, refused and done, without the email or the token', async () => {
    const email = `erase-${crypto.randomUUID()}@example.com`;
    expect((await post(email, '/api/erase', { token: 'guess' })).status).toBe(
      403,
    );
    const token = await eraseToken(email);
    expect((await post(email, '/api/erase', { token })).status).toBe(200);
    expect(security('erase')).toEqual([
      {
        level: 'info',
        what: 'security',
        event: 'erase',
        requestId: expect.any(String),
        outcome: 'refused',
        space: 'main',
      },
      {
        level: 'info',
        what: 'security',
        event: 'erase',
        requestId: expect.any(String),
        outcome: 'ok',
        space: 'main',
      },
    ]);
    const text = lines.map((l) => l.text).join('\n');
    expect(text).not.toContain(email);
    expect(text).not.toContain(token);
  });

  it('logs an import with its counts, and a restore', async () => {
    const email = `import-${crypto.randomUUID()}@example.com`;
    expect((await post(email, '/api/import', fixture)).status).toBe(200);
    const [imported] = security('import');
    expect(imported).toMatchObject({ event: 'import', outcome: 'ok' });
    const counts = (imported?.imported ?? {}) as Record<string, number>;
    expect(counts.projects).toBeGreaterThan(0);
    expect(
      (await post(email, '/api/backups/restore', { day: '2020-01-01' })).status,
    ).toBe(404);
    expect(security('restore')).toEqual([
      {
        level: 'info',
        what: 'security',
        event: 'restore',
        requestId: expect.any(String),
        outcome: 'refused',
        space: 'main',
      },
    ]);
    expect(lines.map((l) => l.text).join('\n')).not.toContain(email);
  });

  it('logs a deleted space', async () => {
    const email = `spaces-${crypto.randomUUID()}@example.com`;
    const created = await bindings.DATAPAD.getByName(email).createSpace('Hoth');
    if (!created.ok) throw new Error(created.error);
    const id = created.value.id;
    const token = await eraseToken(email, id);
    expect(
      (await post(email, '/api/spaces/delete', { id, token })).status,
    ).toBe(200);
    expect(security('deleteSpace')).toEqual([
      {
        level: 'info',
        what: 'security',
        event: 'deleteSpace',
        requestId: expect.any(String),
        outcome: 'ok',
        space: id,
      },
    ]);
  });

  it('every security line has only the documented keys', async () => {
    const email = `shape-${crypto.randomUUID()}@example.com`;
    await post(email, '/api/import', fixture);
    await post(email, '/api/erase', { token: await eraseToken(email) });
    const all = lines.filter((l) => l.json.what === 'security');
    expect(all.length).toBeGreaterThanOrEqual(2);
    for (const { json, text } of all) {
      for (const key of Object.keys(json)) {
        expect(SECURITY_KEYS.has(key), key).toBe(true);
      }
      expect(text).not.toMatch(/@/);
    }
  });
});

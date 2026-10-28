import type { ConsentDescription } from '@cloudflare/workers-oauth-provider';

/**
 * The consent page at `/oauth/authorize` (#152): who is asking, where the
 * tokens will go, what they may do, Allow or Deny. Server-rendered, with
 * no script at all and one style block allowed by its hash, so the CSP is
 * as tight as the API's. Everything that came from the client (its name,
 * the redirect host) is escaped: an attacker chooses those at
 * registration.
 *
 * The form carries only the provider's consent handle, which works once,
 * for ten minutes, and only in the browser holding the `__Host-` cookie
 * `beginConsent()` set with it: that pair is the page's CSRF token.
 */

const STYLE = `
  :root { color-scheme: light dark; --fg: #18181b; --muted: #52525b; --bg: #fafafa;
    --card: #ffffff; --line: #d4d4d8; --warn: #92400e; --accent: #18181b; --on-accent: #fafafa; }
  @media (prefers-color-scheme: dark) {
    :root { --fg: #f4f4f5; --muted: #a1a1aa; --bg: #09090b; --card: #18181b;
      --line: #3f3f46; --warn: #fbbf24; --accent: #f4f4f5; --on-accent: #09090b; }
  }
  * { box-sizing: border-box; }
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; min-height: 100dvh;
    display: grid; place-items: center; padding: 1rem; color: var(--fg); background: var(--bg); }
  main { width: 100%; max-width: 30rem; background: var(--card); border: 1px solid var(--line);
    border-radius: 0.5rem; padding: 1.5rem; }
  h1 { font-size: 1.25rem; margin: 0 0 0.75rem; overflow-wrap: anywhere; }
  p { margin: 0 0 0.75rem; overflow-wrap: anywhere; }
  .muted { color: var(--muted); font-size: 0.875rem; }
  .warn { color: var(--warn); }
  fieldset { border: 1px solid var(--line); border-radius: 0.375rem; margin: 1rem 0; padding: 0.75rem 1rem; }
  legend { padding: 0 0.25rem; font-weight: 600; }
  label { display: flex; gap: 0.75rem; align-items: flex-start; min-height: 44px; padding: 0.25rem 0; }
  input[type="checkbox"] { width: 1.25rem; height: 1.25rem; margin: 0.125rem 0 0; flex: none; }
  .actions { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-top: 1rem; }
  button { font: inherit; min-height: 44px; min-width: 6rem; padding: 0.5rem 1rem; border-radius: 0.375rem;
    border: 1px solid var(--line); background: transparent; color: var(--fg); cursor: pointer; }
  button[value="approve"] { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; }
`;

const HTML_HEAD = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="referrer" content="no-referrer">`;

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

let styleHash: Promise<string> | undefined;

/** The CSP source that allows `STYLE` and nothing else inline. */
function styleSource(): Promise<string> {
  styleHash ??= crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(STYLE))
    .then(
      (digest) =>
        `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`,
    );
  return styleHash;
}

/**
 * The page's CSP. `form-action` names the redirect's origin as well as
 * this one, because browsers hold the redirect after a form post to it.
 */
async function pageCsp(redirectOrigin?: string): Promise<string> {
  const formAction = ["'self'", redirectOrigin].filter(Boolean).join(' ');
  return [
    "default-src 'none'",
    `style-src ${await styleSource()}`,
    `form-action ${formAction}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join('; ');
}

/** An `http(s)` redirect URI's origin, else nothing (the CSP stays 'self'). */
function originOf(uri: string): string | undefined {
  try {
    const url = new URL(uri);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}

/** The headers every page here carries, on top of any the provider adds. */
async function pageHeaders(
  extra: Headers | undefined,
  redirectOrigin?: string,
): Promise<Headers> {
  const headers = new Headers(extra);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('content-security-policy', await pageCsp(redirectOrigin));
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('cache-control', 'no-store');
  headers.set(
    'strict-transport-security',
    'max-age=31536000; includeSubDomains',
  );
  return headers;
}

export function consentHtml(
  details: ConsentDescription,
  handle: string,
  email: string,
): string {
  const name = escapeHtml(details.clientName);
  const host = escapeHtml(details.redirectHost);
  const origin = details.clientDomain
    ? `Published by <strong>${escapeHtml(details.clientDomain)}</strong>.`
    : 'This app registered itself; its name is not verified.';
  const loopback = details.redirectIsLoopback
    ? '<p class="warn"><strong>This sends access to an app on this computer.</strong> Continue only if you just started connecting from it.</p>'
    : '';
  // Ticked only when the client asked for it (#232); the owner can still
  // tick it, or leave it.
  const writeAsked = details.scope.includes('write');
  return `${HTML_HEAD}
<title>Connect ${name} · Datapad</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <h1>Allow ${name} to use your Datapad?</h1>
  <p>${origin} Access will be sent to <strong>${host}</strong>.</p>
  ${loopback}
  <p class="muted">Signed in as ${escapeHtml(email)}. It acts as you, in every space, for up to 30 days; then you connect it again.</p>
  <form method="post">
    <input type="hidden" name="handle" value="${escapeHtml(handle)}">
    <fieldset>
      <legend>It may</legend>
      <label><input type="checkbox" checked disabled> <span><strong>read</strong>: see your spaces, projects, tasks, notes, meetings and people</span></label>
      <label><input type="checkbox" name="write" value="1"${writeAsked ? ' checked' : ''}> <span><strong>write</strong>: add and change them</span></label>
    </fieldset>
    <div class="actions">
      <button type="submit" name="decision" value="approve">Allow</button>
      <button type="submit" name="decision" value="deny">Deny</button>
    </div>
  </form>
</main>
</body>
</html>
`;
}

/** The consent page, with the provider's binding cookie. */
export async function consentPage(
  details: ConsentDescription,
  handle: string,
  email: string,
  providerHeaders: Headers,
): Promise<Response> {
  return new Response(consentHtml(details, handle, email), {
    headers: await pageHeaders(providerHeaders, originOf(details.redirectUri)),
  });
}

/** A short page for an authorization that cannot go on. */
export async function problemPage(
  message: string,
  status = 400,
): Promise<Response> {
  const html = `${HTML_HEAD}
<title>Cannot connect · Datapad</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <h1>Cannot connect</h1>
  <p>${escapeHtml(message)}</p>
  <p class="muted">Start connecting again from your app.</p>
</main>
</body>
</html>
`;
  return new Response(html, { status, headers: await pageHeaders(undefined) });
}

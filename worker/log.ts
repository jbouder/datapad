/**
 * The Worker's own log lines and request ids (#236). Every line is one
 * JSON object (docs/architecture.md#logs). None carries an email, a token,
 * a request body or anything from a document.
 */

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * The request's id: Cloudflare's `cf-ray`, which also names the request in
 * Cloudflare's own logs, so an id the owner reads off a 500 finds both.
 * Local runs have no ray; a random id stands in.
 */
export function requestIdOf(request: Request): string {
  const ray = request.headers.get('cf-ray')?.trim() ?? '';
  return /^[\w-]{1,64}$/.test(ray) ? ray : crypto.randomUUID();
}

/**
 * `response` with `x-request-id` set. A response from `fetch()` (assets,
 * the object) has immutable headers, so it is copied; a WebSocket upgrade
 * keeps its socket.
 */
export function withRequestId(response: Response, id: string): Response {
  const headers = new Headers(response.headers);
  headers.set(REQUEST_ID_HEADER, id);
  if (response.webSocket) {
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      webSocket: response.webSocket,
      headers,
    });
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** One line for a request that threw; the client got a 500 with `id`. */
export function logError(id: string, path: string, error: unknown): void {
  console.error(
    JSON.stringify({
      level: 'error',
      path,
      requestId: id,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

/**
 * The security events (#236): who did what is the Access log's to say; this
 * says what changed. Never the email, a token or a confirmation.
 */
export type SecurityEvent =
  | 'grant'
  | 'revoke'
  | 'erase'
  | 'deleteSpace'
  | 'import'
  | 'restore';

/** What a security line may carry besides the event: ids and counts only. */
export interface SecurityFields {
  outcome: 'ok' | 'refused';
  space?: string;
  clientId?: string;
  grantId?: string;
  scope?: string[];
  /** How many documents of each kind came in. */
  imported?: Record<string, number>;
}

export function logSecurity(
  event: SecurityEvent,
  id: string,
  fields: SecurityFields,
): void {
  console.log(
    JSON.stringify({
      level: 'info',
      what: 'security',
      event,
      requestId: id,
      ...fields,
    }),
  );
}

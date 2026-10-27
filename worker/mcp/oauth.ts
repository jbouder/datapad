import {
  getOAuthApi,
  type OAuthHelpers,
  OAuthProvider,
  type OAuthProviderOptions,
} from '@cloudflare/workers-oauth-provider';
import type { Bindings } from '../env';
import { mcpApiHandler } from './server';

/**
 * Datapad as its own OAuth 2.1 authorization server, for MCP clients only
 * (#152). Browsers sign in with Cloudflare Access; an MCP client cannot,
 * so it gets a bearer token from here instead, and `/oauth/authorize`,
 * where a person approves it, is itself behind Access.
 *
 * `@cloudflare/workers-oauth-provider` does the protocol: discovery,
 * dynamic client registration, PKCE (S256 only), the token endpoint with
 * refresh and revocation, and the bearer check on `/mcp`. Tokens, codes
 * and secrets are stored in `OAUTH_KV` only as hashes; a grant's `props`
 * (the email) are encrypted with a key only the token holder can unwrap.
 *
 * The one place an email enters a token is `completeAuthorization()` in
 * `authorize.ts`, from the identity Access verified. `/mcp` reads it back
 * from `ctx.props` and names the Durable Object with it, and nothing else.
 */

export const MCP_PATH = '/mcp';
export const AUTHORIZE_PATH = '/oauth/authorize';
export const TOKEN_PATH = '/oauth/token';
export const REGISTER_PATH = '/oauth/register';

/**
 * What a token may do. `read` is always granted; `write` is the owner's
 * choice on the consent page (write tools arrive in #154).
 */
export const SCOPES = ['read', 'write'] as const;
export type Scope = (typeof SCOPES)[number];

/** One hour; the client refreshes. */
export const ACCESS_TOKEN_TTL_S = 60 * 60;
/** Thirty days from sign-in, however often it is refreshed. */
export const REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60;

/** What a grant carries to `/mcp`: the verified email, nothing else. */
export interface McpProps {
  email: string;
}

/**
 * The paths the provider answers before, and instead of, the Access check.
 * They are also the paths of the Bypass application at the edge
 * (docs/self-hosting.md). Each admits nobody by itself: discovery is
 * public metadata, registration stores a client that can do nothing until
 * a signed-in person approves it at `/oauth/authorize`, the token endpoint
 * wants a code or refresh token it issued (with PKCE), and `/mcp` wants a
 * bearer it issued. `/oauth/authorize` is not here: it stays behind Access.
 */
export function isProviderPath(pathname: string): boolean {
  return (
    pathname === MCP_PATH ||
    pathname.startsWith(`${MCP_PATH}/`) ||
    pathname === TOKEN_PATH ||
    pathname === REGISTER_PATH ||
    pathname === '/.well-known/oauth-authorization-server' ||
    pathname.startsWith('/.well-known/oauth-authorization-server/') ||
    pathname === '/.well-known/oauth-protected-resource' ||
    pathname.startsWith('/.well-known/oauth-protected-resource/')
  );
}

/**
 * The grant's user id: the email, with anything the provider reserves
 * (`:` separates the parts of its keys) percent-encoded. Grants list under
 * it, so revoking (#154) finds every client the owner approved.
 */
export function grantUserId(email: string): string {
  return encodeURIComponent(email);
}

/**
 * The provider's options for one origin. The resource (and so every
 * token's audience) is `<origin>/mcp`: a token issued on one hostname is
 * refused on another.
 */
export function providerOptions(
  origin: string,
): OAuthProviderOptions<Bindings> {
  return {
    apiRoute: MCP_PATH,
    apiHandler: mcpApiHandler,
    // Only the paths in `isProviderPath` are sent here, and the provider
    // answers all of them itself; anything else fails closed.
    defaultHandler: {
      fetch: () => new Response('Not found', { status: 404 }),
    },
    authorizeEndpoint: AUTHORIZE_PATH,
    tokenEndpoint: TOKEN_PATH,
    clientRegistrationEndpoint: REGISTER_PATH,
    scopesSupported: [...SCOPES],
    accessTokenTTL: ACCESS_TOKEN_TTL_S,
    refreshTokenTTL: REFRESH_TOKEN_TTL_S,
    resourceMetadata: {
      resource: `${origin}${MCP_PATH}`,
      resource_name: 'Datapad',
    },
  };
}

const providers = new Map<string, OAuthProvider<Bindings>>();

/** The provider for this request's origin, one per isolate per origin. */
export function providerFor(request: Request): OAuthProvider<Bindings> {
  const { origin } = new URL(request.url);
  let provider = providers.get(origin);
  if (!provider) {
    provider = new OAuthProvider(providerOptions(origin));
    providers.set(origin, provider);
  }
  return provider;
}

/** The provider's helpers (parse, consent, grants) for this origin. */
export function oauthHelpers(request: Request, env: Bindings): OAuthHelpers {
  return getOAuthApi(providerOptions(new URL(request.url).origin), env);
}

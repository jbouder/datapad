import {
  AuthorizationError,
  CimdFetchError,
} from '@cloudflare/workers-oauth-provider';
import type { AccessIdentity } from '../access';
import type { Bindings } from '../env';
import { consentPage, problemPage } from './consent';
import { grantUserId, type McpProps, oauthHelpers, type Scope } from './oauth';

/**
 * `/oauth/authorize` (#152): the sign-in for MCP clients. It is reached
 * only from `createHandler` in worker/index.ts, after `verifyAccess()`
 * returned an identity, so the person here is the signed-in owner.
 *
 * GET shows the consent page for a request the provider validated (client,
 * exact redirect URI, PKCE, resource). POST takes the decision: Deny
 * redirects back with `access_denied`; Allow completes the authorization
 * with `props: { email }` from the verified identity. That is the only
 * place an email enters a token.
 */
export async function authorize(
  request: Request,
  env: Bindings,
  identity: AccessIdentity,
): Promise<Response> {
  const oauth = oauthHelpers(request, env);
  try {
    if (request.method === 'GET') {
      const authRequest = await oauth.parseAuthRequest(request);
      // First: a failed lookup leaves nothing behind in KV.
      const details = await oauth.describeConsent(authRequest);
      const consent = await oauth.beginConsent(authRequest);
      return await consentPage(
        details,
        consent.handle,
        identity.email,
        consent.headers,
      );
    }

    if (request.method === 'POST') {
      const origin = request.headers.get('Origin');
      if (origin !== null && origin !== new URL(request.url).origin) {
        return await problemPage('Cross-site request refused.', 403);
      }
      const form = await request.formData();
      const handle = String(form.get('handle') ?? '');
      if (form.get('decision') !== 'approve') {
        const denied = await oauth.denyConsent(request, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const scope: Scope[] = form.get('write') ? ['read', 'write'] : ['read'];
      const approved = await oauth.approveConsent(request, handle, { scope });
      const client = await oauth.lookupClient(approved.request.clientId);
      const props: McpProps = { email: identity.email };
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId: grantUserId(identity.email),
        // Storage-visible, not secret: what a list of grants shows (#154).
        metadata: { clientName: client?.clientName ?? null },
        scope: approved.request.scope,
        props,
      });
      approved.headers.set('Location', redirectTo);
      return new Response(null, { status: 302, headers: approved.headers });
    }

    return await problemPage('Method not allowed.', 405);
  } catch (error) {
    // A redirect back to the client only once the provider has validated
    // the client and its exact redirect URI; anything else is shown here.
    if (error instanceof AuthorizationError && error.redirectTo) {
      return Response.redirect(error.redirectTo, 302);
    }
    if (error instanceof AuthorizationError) {
      return await problemPage(
        error.description || 'This authorization request is not valid.',
      );
    }
    if (error instanceof CimdFetchError) {
      return await problemPage('This app could not be verified.');
    }
    throw error;
  }
}

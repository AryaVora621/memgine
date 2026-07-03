import { authedClient } from '@/lib/serverSupabase';
import {
  discoverAuthServer,
  registerClient,
  newPkcePair,
  buildAuthorizationUrl,
  exchangeCode,
  type OAuthState,
} from '@/lib/mcpOauth';
import type { Connector } from '@/lib/mcp';

// OAuth for MCP connectors, two legs on one route:
//   POST {action:"start", connectorId, origin} -> discovers the auth server,
//     registers a client, stores PKCE state, returns the authorization URL.
//   POST {action:"exchange", code, state} -> called by /oauth/callback (the
//     browser redirect can't carry the JWT, so the callback page forwards the
//     code with the operator session) -> stores tokens.

export async function POST(req: Request) {
  try {
    const auth = await authedClient(req);
    if (auth === 'unauthorized' || auth === null) {
      return Response.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
    }
    const { db } = auth;
    const body = await req.json();

    if (body.action === 'start') {
      const { connectorId, origin } = body;
      if (!connectorId || !origin) {
        return Response.json({ success: false, error: 'connectorId and origin are required' }, { status: 400 });
      }
      const { data: conn } = await db.from('connectors').select('*').eq('id', connectorId).single();
      if (!conn) return Response.json({ success: false, error: 'Connector not found' }, { status: 404 });

      const meta = await discoverAuthServer(conn.url);
      const redirectUri = `${origin}/oauth/callback`;

      const existing = (conn.oauth || {}) as Partial<OAuthState>;
      let client_id = existing.client_id;
      let client_secret = existing.client_secret;
      // Re-register when the redirect URI changed (e.g. localhost vs prod).
      if (!client_id || existing.redirect_uri !== redirectUri) {
        if (!meta.registration_endpoint) {
          return Response.json({
            success: false,
            error: 'This server does not support dynamic client registration; add a static token instead.',
          }, { status: 400 });
        }
        const reg = await registerClient(meta.registration_endpoint, redirectUri);
        client_id = reg.client_id;
        client_secret = reg.client_secret;
      }

      const { verifier, state } = newPkcePair();
      const oauth: OAuthState = {
        authorization_endpoint: meta.authorization_endpoint,
        token_endpoint: meta.token_endpoint,
        client_id: client_id!,
        client_secret,
        verifier,
        state,
        redirect_uri: redirectUri,
        // Keep any previously granted tokens until the new grant lands.
        access_token: existing.access_token,
        refresh_token: existing.refresh_token,
        expires_at: existing.expires_at,
      };
      await db.from('connectors').update({ oauth }).eq('id', connectorId);
      return Response.json({ success: true, authUrl: buildAuthorizationUrl(oauth, conn.url) });
    }

    if (body.action === 'exchange') {
      const { code, state } = body;
      if (!code || !state) {
        return Response.json({ success: false, error: 'code and state are required' }, { status: 400 });
      }
      const { data: conns } = await db.from('connectors').select('*').not('oauth', 'is', null);
      const conn = (conns || []).find((c: Connector & { oauth?: OAuthState }) => c.oauth?.state === state);
      if (!conn) return Response.json({ success: false, error: 'No pending OAuth flow matches this state.' }, { status: 400 });

      const oauth = await exchangeCode(conn.oauth as OAuthState, code, conn.url);
      await db.from('connectors').update({ oauth }).eq('id', conn.id);
      return Response.json({ success: true, connector: conn.name });
    }

    return Response.json({ success: false, error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

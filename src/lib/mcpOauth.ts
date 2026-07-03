/**
 * OAuth 2.1 client for MCP connectors, per the MCP authorization spec:
 * protected-resource metadata discovery (RFC 9728) -> authorization-server
 * metadata (RFC 8414) -> dynamic client registration (RFC 7591) -> PKCE
 * authorization-code flow. Server-side only.
 */

import { createHash, randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Connector } from '@/lib/mcp';

export interface OAuthState {
  authorization_endpoint: string;
  token_endpoint: string;
  client_id: string;
  client_secret?: string;
  // Pending-flow fields, cleared after the code exchange:
  verifier?: string;
  state?: string;
  redirect_uri?: string;
  // Granted tokens:
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Find the authorization server for an MCP endpoint. Preferred path is the
 * protected-resource metadata; fall back to probing the MCP origin itself,
 * which many servers use as their own authorization server.
 */
export async function discoverAuthServer(mcpUrl: string): Promise<{ authorization_endpoint: string; token_endpoint: string; registration_endpoint?: string }> {
  const u = new URL(mcpUrl);
  const origin = u.origin;
  const pathSuffix = u.pathname.replace(/\/$/, '');

  const authServerCandidates: string[] = [];
  for (const prUrl of [
    `${origin}/.well-known/oauth-protected-resource${pathSuffix}`,
    `${origin}/.well-known/oauth-protected-resource`,
  ]) {
    const pr = await fetchJson(prUrl);
    const servers = pr?.authorization_servers;
    if (Array.isArray(servers)) authServerCandidates.push(...(servers as string[]));
    if (authServerCandidates.length) break;
  }
  if (authServerCandidates.length === 0) authServerCandidates.push(origin);

  for (const server of authServerCandidates) {
    const so = new URL(server);
    for (const metaUrl of [
      `${so.origin}/.well-known/oauth-authorization-server${so.pathname.replace(/\/$/, '')}`,
      `${so.origin}/.well-known/oauth-authorization-server`,
      `${so.origin}/.well-known/openid-configuration`,
    ]) {
      const meta = await fetchJson(metaUrl);
      if (meta?.authorization_endpoint && meta?.token_endpoint) {
        return {
          authorization_endpoint: meta.authorization_endpoint as string,
          token_endpoint: meta.token_endpoint as string,
          registration_endpoint: meta.registration_endpoint as string | undefined,
        };
      }
    }
  }
  throw new Error('Could not discover an OAuth authorization server for this MCP URL.');
}

/** RFC 7591 dynamic client registration. */
export async function registerClient(
  registrationEndpoint: string,
  redirectUri: string
): Promise<{ client_id: string; client_secret?: string }> {
  const res = await fetch(registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Memgine',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`Client registration failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data.client_id) throw new Error('Registration response had no client_id.');
  return { client_id: data.client_id, client_secret: data.client_secret };
}

export function buildAuthorizationUrl(oauth: OAuthState, mcpUrl: string): string {
  const url = new URL(oauth.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', oauth.client_id);
  url.searchParams.set('redirect_uri', oauth.redirect_uri!);
  url.searchParams.set('state', oauth.state!);
  url.searchParams.set('code_challenge', b64url(createHash('sha256').update(oauth.verifier!).digest()));
  url.searchParams.set('code_challenge_method', 'S256');
  // RFC 8707 resource indicator, required by the MCP auth spec.
  url.searchParams.set('resource', mcpUrl);
  return url.toString();
}

export function newPkcePair(): { verifier: string; state: string } {
  return { verifier: b64url(randomBytes(32)), state: b64url(randomBytes(16)) };
}

async function tokenRequest(oauth: OAuthState, params: Record<string, string>): Promise<OAuthState> {
  const body = new URLSearchParams({ client_id: oauth.client_id, ...params });
  if (oauth.client_secret) body.set('client_secret', oauth.client_secret);
  const res = await fetch(oauth.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Token request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (!data.access_token) throw new Error('Token response had no access_token.');
  return {
    ...oauth,
    verifier: undefined,
    state: undefined,
    access_token: data.access_token,
    refresh_token: data.refresh_token || oauth.refresh_token,
    expires_at: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  };
}

export async function exchangeCode(oauth: OAuthState, code: string, mcpUrl: string): Promise<OAuthState> {
  return tokenRequest(oauth, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: oauth.redirect_uri!,
    code_verifier: oauth.verifier!,
    resource: mcpUrl,
  });
}

export async function refreshTokens(oauth: OAuthState, mcpUrl: string): Promise<OAuthState> {
  if (!oauth.refresh_token) throw new Error('No refresh token; reconnect the connector.');
  return tokenRequest(oauth, {
    grant_type: 'refresh_token',
    refresh_token: oauth.refresh_token,
    resource: mcpUrl,
  });
}

/**
 * Resolve the bearer token for a connector: static auth_token wins; otherwise
 * use OAuth tokens, refreshing (and persisting) when within 60s of expiry.
 */
export async function resolveConnectorAuth(db: SupabaseClient, conn: Connector & { oauth?: OAuthState | null }): Promise<Connector> {
  if (conn.auth_token || !conn.oauth?.access_token) return conn;
  let oauth = conn.oauth;
  if (oauth.expires_at && Date.now() > oauth.expires_at - 60000) {
    oauth = await refreshTokens(oauth, conn.url);
    await db.from('connectors').update({ oauth }).eq('id', conn.id);
  }
  return { ...conn, auth_token: oauth.access_token! };
}

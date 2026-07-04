import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'crypto';

// Auth for Memgine's own MCP *server* (external agents connecting in), as
// opposed to serverSupabase.ts's authedClient (Memgine's browser session
// calling its own API routes). External MCP clients aren't Supabase Auth
// sessions, so they carry a static key instead of a user JWT; on success we
// hand back a service-role client since there's no user JWT for RLS to key
// off of. The key itself is single-operator, mirroring operator_settings.

export function hashMcpKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function generateMcpKey(): string {
  return `mg_${randomBytes(24).toString('hex')}`;
}

function serviceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

export async function verifyMcpKey(req: Request): Promise<SupabaseClient | null> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const db = serviceClient();
  if (!db) return null;
  const { data } = await db
    .from('operator_settings')
    .select('mcp_key_hash')
    .eq('id', true)
    .single();
  if (!data?.mcp_key_hash || data.mcp_key_hash !== hashMcpKey(token)) return null;
  return db;
}

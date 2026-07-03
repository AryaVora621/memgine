import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// JWT-scoped Supabase client for API routes: RLS applies as the caller.
// Returns null when Supabase env is absent (bare local setup) and
// 'unauthorized' when a token is missing or invalid.

export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anonKey ? { url, anonKey } : null;
}

export async function authedClient(
  req: Request
): Promise<{ db: SupabaseClient; token: string } | null | 'unauthorized'> {
  const env = getSupabaseEnv();
  if (!env) return null;
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return 'unauthorized';
  const db = createClient(env.url, env.anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return 'unauthorized';
  return { db, token };
}

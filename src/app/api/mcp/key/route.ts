import { authedClient } from '@/lib/serverSupabase';
import { generateMcpKey, hashMcpKey } from '@/lib/mcpServerAuth';

// Regenerates the operator's static MCP server key from the Settings UI
// (a normal browser-session request, unlike /api/mcp itself which external
// agents call with the key this route hands out). Returns plaintext once —
// only the sha256 hash is ever persisted.

export async function POST(req: Request) {
  const auth = await authedClient(req);
  if (auth === 'unauthorized' || auth === null) {
    return Response.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }
  const { db } = auth;

  const key = generateMcpKey();
  const { error } = await db
    .from('operator_settings')
    .update({ mcp_key_hash: hashMcpKey(key), mcp_key_created_at: new Date().toISOString() })
    .eq('id', true);
  if (error) return Response.json({ success: false, error: error.message }, { status: 500 });

  return Response.json({ success: true, key });
}

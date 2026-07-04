import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { toFetchResponse, toReqRes } from 'fetch-to-node';
import { z } from 'zod';
import { verifyMcpKey } from '@/lib/mcpServerAuth';
import { GLOBAL_PROJECT_ID } from '@/lib/tags';
import { getSupabaseEnv } from '@/lib/serverSupabase';

// match_memories casts p_query straight to vector(384), so it must already be
// a stringified embedding, not raw text. This MCP server has no user JWT (the
// caller authenticates with a static key), so it embeds with the service-role
// key, same as the `embed` edge function's own backfill path.
async function embedQuery(text: string): Promise<string | null> {
  const env = getSupabaseEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env || !serviceKey) return null;
  try {
    const res = await fetch(`${env.url}/functions/v1/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.embedding) ? JSON.stringify(data.embedding) : null;
  } catch {
    return null;
  }
}

// Memgine as an MCP *server*: any MCP-speaking agent (Claude Desktop, Gemini,
// a CLI tool) can connect here with the operator's static key and share the
// same Memory Palace the chat UI reads and writes, so a fact added from one
// client is visible everywhere. Stateless StreamableHTTP (no session id) is
// the documented pattern for serverless handlers — a fresh McpServer/transport
// pair per request, since there's no long-lived process to hold a session.

function buildServer(db: Awaited<ReturnType<typeof verifyMcpKey>> & object) {
  const server = new McpServer({ name: 'memgine', version: '1.0.0' });

  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description: 'List every Memgine project (directory) the operator has, with id, name, and path.',
      inputSchema: {},
    },
    async () => {
      const { data, error } = await db
        .from('projects')
        .select('id, name, path')
        .neq('id', GLOBAL_PROJECT_ID)
        .order('created_at', { ascending: true });
      if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    'search_memories',
    {
      title: 'Search memory palace',
      description:
        'Hybrid semantic + keyword search over a project\'s Memory Palace (plus GLOBAL cross-project facts). Use this before answering anything about the operator\'s projects, preferences, or ongoing work.',
      inputSchema: {
        projectId: z.string().uuid().optional().describe('Project id from list_projects, or omit to search GLOBAL only'),
        query: z.string().describe('Natural-language search query'),
        limit: z.number().int().min(1).max(20).optional(),
      },
    },
    async ({ projectId, query, limit }) => {
      const terms = query.split(/\s+/).filter(w => w.length > 2).slice(0, 8);
      const queryEmbedding = await embedQuery(query);
      const { data, error } = await db.rpc('match_memories', {
        p_project: projectId || GLOBAL_PROJECT_ID,
        p_query: queryEmbedding,
        p_terms: terms,
        p_k: limit || 8,
      });
      if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    'add_fact',
    {
      title: 'Add a memory fact',
      description:
        'Store a durable fact in the Memory Palace, scoped to one project or GLOBAL (visible from every project). Mirrors the ADD_FACT flow in the Memgine chat UI.',
      inputSchema: {
        projectId: z.string().uuid().optional().describe('Omit or use GLOBAL scope for a cross-project fact'),
        scope: z.enum(['project', 'global']).default('project'),
        name: z.string().describe('Short kebab-case slug, e.g. "prefers-terse-replies"'),
        description: z.string().describe('One-line summary of the fact'),
        type: z.enum(['user', 'feedback', 'project', 'reference']).default('project'),
        content: z.string().describe('The fact body'),
      },
    },
    async ({ projectId, scope, name, description, type, content }) => {
      const target = scope === 'global' ? GLOBAL_PROJECT_ID : projectId;
      if (!target) {
        return { content: [{ type: 'text', text: 'Error: projectId is required unless scope="global"' }], isError: true };
      }
      const { error } = await db
        .from('project_memories')
        .upsert(
          { project_id: target, room_name: 'GENERAL', name, description, mem_type: type, fact_content: content },
          { onConflict: 'project_id,name' }
        );
      if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: 'text', text: `Stored "${name}" in ${scope === 'global' ? 'GLOBAL' : target}.` }] };
    }
  );

  return server;
}

export async function POST(req: Request) {
  const db = await verifyMcpKey(req);
  if (!db) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const server = buildServer(db);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  const { req: nodeReq, res: nodeRes } = toReqRes(req);
  await server.connect(transport);
  await transport.handleRequest(nodeReq, nodeRes, await req.json().catch(() => undefined));

  const response = await toFetchResponse(nodeRes);
  nodeRes.on('close', () => {
    transport.close();
    server.close();
  });
  return response;
}

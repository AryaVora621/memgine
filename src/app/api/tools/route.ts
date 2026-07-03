import { authedClient } from '@/lib/serverSupabase';
import { listConnectorTools, callConnectorTool, toolResultToText, type Connector } from '@/lib/mcp';
import { resolveConnectorAuth } from '@/lib/mcpOauth';

// Connector tools: GET lists connectors with their live tool catalogs;
// POST executes one tool call (approval-gated in the UI) and persists the
// result as a system message so the model sees it in history next turn.

export async function GET(req: Request) {
  const auth = await authedClient(req);
  if (auth === 'unauthorized' || auth === null) {
    return Response.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }
  const { db } = auth;

  const { data: connectors, error } = await db.from('connectors').select('*').order('created_at');
  if (error) return Response.json({ success: false, error: error.message }, { status: 500 });

  const results = await Promise.all(
    (connectors as Connector[]).map(async conn => {
      if (!conn.enabled) return { ...conn, auth_token: undefined, oauth: undefined, tools: [], status: 'disabled' };
      try {
        const tools = await listConnectorTools(await resolveConnectorAuth(db, conn));
        return { ...conn, auth_token: undefined, oauth: undefined, tools, status: 'online' };
      } catch (e) {
        return {
          ...conn,
          auth_token: undefined,
          oauth: undefined,
          tools: [],
          status: 'offline',
          error: e instanceof Error ? e.message : 'unreachable',
        };
      }
    })
  );
  return Response.json({ success: true, connectors: results });
}

export async function POST(req: Request) {
  try {
    const auth = await authedClient(req);
    if (auth === 'unauthorized' || auth === null) {
      return Response.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
    }
    const { db } = auth;

    const { connector, tool, args = {}, projectId, chatId } = await req.json();
    if (!connector || !tool) {
      return Response.json({ success: false, error: 'connector and tool are required' }, { status: 400 });
    }

    const { data: conn } = await db.from('connectors')
      .select('*')
      .eq('name', connector)
      .eq('enabled', true)
      .single();
    if (!conn) {
      return Response.json({ success: false, error: `Connector "${connector}" not found or disabled` }, { status: 404 });
    }

    const result = await callConnectorTool(await resolveConnectorAuth(db, conn as Connector), tool, args);
    const text = toolResultToText(result);

    if (projectId && chatId) {
      await db.from('memories').insert({
        project_id: projectId,
        chat_id: chatId,
        content: `[ TOOL_RESULT / ${connector}.${tool} ]\n${text}`,
        role: 'system',
        metadata: { toolResult: { connector, tool, args } },
        parent_id: null,
        timestamp: new Date().toISOString(),
      });
    }

    return Response.json({ success: true, text });
  } catch (error) {
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

/**
 * Minimal MCP (Model Context Protocol) client over Streamable HTTP.
 * Server-side only. Each operation performs its own handshake — sessions are
 * cheap at single-operator scale and statelessness keeps the route simple.
 */

export interface Connector {
  id: string;
  name: string;
  url: string;
  auth_token: string | null;
  enabled: boolean;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

const PROTOCOL_VERSION = '2025-03-26';
const REQUEST_TIMEOUT_MS = 15000;

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

// Streamable HTTP servers may answer JSON-RPC POSTs with plain JSON or an SSE
// stream; for request/response usage the SSE stream carries one data event.
async function parseRpcResponse(res: Response): Promise<JsonRpcResponse | null> {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    const text = await res.text();
    for (const line of text.split('\n')) {
      if (line.startsWith('data:')) {
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          const parsed = JSON.parse(payload);
          if (parsed.id !== undefined || parsed.result !== undefined || parsed.error) return parsed;
        } catch {}
      }
    }
    return null;
  }
  if (res.status === 202 || res.status === 204) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

class McpSession {
  private sessionId: string | null = null;
  private nextId = 1;

  constructor(private url: string, private token: string | null) {}

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {}),
      ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
    };
  }

  private async post(body: Record<string, unknown>): Promise<JsonRpcResponse | null> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;
    if (!res.ok && res.status !== 202) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`MCP server error ${res.status}: ${detail}`);
    }
    return parseRpcResponse(res);
  }

  async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const response = await this.post({ jsonrpc: '2.0', id: this.nextId++, method, params });
    if (response?.error) throw new Error(`MCP ${method} failed: ${response.error.message}`);
    return response?.result;
  }

  async notify(method: string): Promise<void> {
    await this.post({ jsonrpc: '2.0', method });
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'memgine', version: '1.0.0' },
    });
    await this.notify('notifications/initialized');
  }
}

export async function listConnectorTools(conn: Connector): Promise<McpTool[]> {
  const session = new McpSession(conn.url, conn.auth_token);
  await session.initialize();
  const result = (await session.request('tools/list')) as { tools?: McpTool[] } | undefined;
  return result?.tools || [];
}

export async function callConnectorTool(
  conn: Connector,
  tool: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const session = new McpSession(conn.url, conn.auth_token);
  await session.initialize();
  return session.request('tools/call', { name: tool, arguments: args });
}

/** Render tool call output (MCP content blocks) as plain text for the chat. */
export function toolResultToText(result: unknown): string {
  const r = result as { content?: { type?: string; text?: string }[]; isError?: boolean } | null;
  if (!r) return '(no result)';
  if (Array.isArray(r.content)) {
    const text = r.content
      .map(c => (c.type === 'text' && c.text ? c.text : `[${c.type || 'non-text'} content]`))
      .join('\n');
    return r.isError ? `TOOL ERROR:\n${text}` : text;
  }
  return JSON.stringify(result, null, 2).slice(0, 8000);
}

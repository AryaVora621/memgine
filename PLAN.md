# PLAN: Connectors v1 (MCP-client layer)

Goal: claude.ai/ChatGPT-style connectors (Notion, GitHub, Google Drive, Canva,
Gmail...) without writing one integration per service. Memgine becomes an MCP
client: any remote MCP server the operator registers becomes a connector, and
its tools become available to the chat model.

## Design

1. `connectors` table (operator-level, RLS via private.is_operator()):
   id, name (unique slug), url, auth_token (nullable bearer), enabled, created_at.
   v1 auth is a static bearer token (PATs, API keys, tokens from services that
   support them). OAuth flows are v2.

2. `src/lib/mcp.ts` (server-only): minimal MCP Streamable-HTTP client.
   JSON-RPC POST with Accept: application/json + text/event-stream; parses
   either plain JSON or SSE responses; honors Mcp-Session-Id. Per-call
   handshake (initialize -> notifications/initialized -> method). Stateless
   per request; sessions are cheap at operator scale.

3. `/api/tools` route (auth-gated):
   - GET: connectors with their live tool lists (for settings UI/debugging).
   - POST {connector, tool, args, projectId, chatId}: tools/call, persist the
     result as a system message in the chat, return the result.

4. Chat integration: /api/chat lists tools from enabled connectors (parallel,
   short timeout, failures degrade to "connector offline") and injects a
   CONNECTED TOOLS catalog into the system prompt with a USE_TOOL tag protocol:
   `<USE_TOOL connector="github" tool="search_issues">{"query":"..."}</USE_TOOL>`

5. UI: USE_TOOL renders as an approval card (same pattern as ADD_FACT):
   RUN TOOL button -> /api/tools -> result appears as a system message and is
   persisted; the model sees it in history on the next turn. Human-in-the-loop
   by design; auto-execution loop is v2.

6. Settings modal gets a CONNECTORS section: add name/url/token, toggle,
   delete, and a TEST button that lists tools.

## Out of scope (v2+)
- OAuth authorization-code flow for servers that require it.
- Automatic agentic tool loops (execute + re-prompt without approval).
- Tool result attachments (images/files returned by tools).

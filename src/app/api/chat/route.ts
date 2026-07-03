import { type SupabaseClient } from '@supabase/supabase-js';
import { loadSettings } from '@/lib/settings';
import { callProvider, streamProvider, type ChatMessage, type ContentPart } from '@/lib/providers';
import { ATTACHMENTS_BUCKET, type Attachment } from '@/lib/attachments';
import { authedClient, getSupabaseEnv } from '@/lib/serverSupabase';
import { listConnectorTools, type Connector, type McpTool } from '@/lib/mcp';

// The server is the source of truth: it fetches personas, memories, and
// history from Supabase itself (scoped to the caller's JWT so RLS applies),
// persists the user message BEFORE calling the model, streams the response
// as SSE, and persists the assistant message when the stream completes.
// Without Supabase env (bare local setup) it falls back to client-sent state.

const RECENT_MESSAGES = 30;   // verbatim history sent to the model
const SUMMARIZE_AFTER = 44;   // unsummarized messages that trigger a fold
const RECALL_TOP_K = 8;       // full memory bodies injected per message
const RECALL_ALL_UNDER = 12;  // small palaces skip recall and inject everything

interface MemoryEntry {
  room_name?: string | null;
  fact_content: string;
  name?: string | null;
  description?: string | null;
  mem_type?: string | null;
}

interface HistoryRow {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content?: string;
  text?: string;
  timestamp?: string;
  metadata?: unknown;
}

// Connector tool lists change rarely; cache per connector for a few minutes so
// chat latency doesn't pay two MCP round trips per registered server.
const TOOLS_CACHE_TTL_MS = 5 * 60 * 1000;
const toolsCache = new Map<string, { tools: McpTool[] | null; at: number }>();

async function cachedConnectorTools(conn: Connector): Promise<McpTool[] | null> {
  const hit = toolsCache.get(conn.id);
  if (hit && Date.now() - hit.at < TOOLS_CACHE_TTL_MS) return hit.tools;
  let tools: McpTool[] | null = null;
  try {
    tools = await listConnectorTools(conn);
  } catch {}
  toolsCache.set(conn.id, { tools, at: Date.now() });
  return tools;
}

// Query embedding via the `embed` edge function (built-in gte-small model).
async function embedQuery(text: string, token: string): Promise<string | null> {
  const env = getSupabaseEnv();
  if (!env) return null;
  try {
    const res = await fetch(`${env.url}/functions/v1/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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

function keywordTerms(text: string): string[] {
  const stop = new Set(['this', 'that', 'with', 'from', 'have', 'what', 'when', 'where', 'should', 'would', 'could', 'about', 'into', 'them', 'they', 'your', 'please']);
  return Array.from(new Set(
    text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)
      .filter(w => w.length > 3 && !stop.has(w))
  )).slice(0, 8);
}

// MemPalace context: always the full index, plus full bodies for the
// hybrid-recalled top K (or everything while the palace is small).
function buildMemoriesContext(all: MemoryEntry[], recalled: MemoryEntry[]): string {
  if (all.length === 0) return '';
  let ctx = `\n\n<MEMORY_PALACE_CONTEXT>\n`;
  ctx += `Long-term memory. Types: user (who the operator is), feedback (guidance on how to work), project (ongoing work and constraints), reference (external pointers). [[name]] links point at other memories in this palace.\n`;

  ctx += `\n[INDEX]\n`;
  for (const pm of all) {
    const hook = pm.description || pm.fact_content.split('\n')[0];
    ctx += `- ${pm.name || 'unnamed'} (${pm.mem_type || 'project'}, ${(pm.room_name || 'GENERAL').toUpperCase()}) — ${hook}\n`;
  }

  const bodies = recalled.length > 0 ? recalled : all;
  ctx += `\n[RECALLED MEMORIES]\n`;
  ctx += recalled.length > 0 && recalled.length < all.length
    ? `The ${bodies.length} most relevant memories in full; ask the operator or check the index for others.\n`
    : `All memories in full.\n`;
  for (const pm of bodies) {
    ctx += `---\nname: ${pm.name || 'unnamed'}\nroom: ${(pm.room_name || 'GENERAL').toUpperCase()}\n`;
    if (pm.description) ctx += `description: ${pm.description}\n`;
    ctx += `type: ${pm.mem_type || 'project'}\n---\n${pm.fact_content}\n`;
  }
  ctx += `</MEMORY_PALACE_CONTEXT>`;
  return ctx;
}

// Fold everything but the most recent messages into the chat's rolling
// summary. Raw messages stay in the DB verbatim (mempalace-style drawers);
// the summary only bounds what is sent to the model.
async function maybeFoldSummary(
  db: SupabaseClient,
  chatId: string,
  priorSummary: string | null,
  unsummarized: { role: string; content: string; timestamp: string }[],
  model: string,
  apiKeys: Record<string, string | undefined>
) {
  if (unsummarized.length < SUMMARIZE_AFTER) return;
  const toFold = unsummarized.slice(0, unsummarized.length - RECENT_MESSAGES);
  if (toFold.length === 0) return;
  const transcript = toFold.map(m => `[${m.role.toUpperCase()}] ${m.content}`).join('\n');
  const prompt: ChatMessage[] = [
    {
      role: 'system',
      content: 'You compress chat history. Produce a dense running summary (under 400 words) preserving decisions, facts, open questions, and operator preferences. Merge the previous summary with the new transcript; drop pleasantries.',
    },
    {
      role: 'user',
      content: `PREVIOUS SUMMARY:\n${priorSummary || '(none)'}\n\nNEW TRANSCRIPT TO FOLD IN:\n${transcript}`,
    },
  ];
  try {
    const result = await callProvider(prompt, model, apiKeys);
    if (result.text.trim()) {
      await db.from('chats').update({
        summary: result.text.trim(),
        summary_upto: toFold[toFold.length - 1].timestamp,
      }).eq('id', chatId);
    }
  } catch {
    // Summary folding is best-effort; a failure just means a longer prompt next time.
  }
}

export async function POST(req: Request) {
  try {
    const auth = await authedClient(req);
    if (auth === 'unauthorized') {
      return Response.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
    }

    const {
      projectId,
      projectName,
      chatId,
      message,
      model,
      agentName,
      agentPersonas,
      attachments = [],
      webSearch = false,
      // Fallbacks used only when Supabase is not configured:
      history: clientHistory = [],
      projectMemories: clientMemories = [],
      projectPersonas: clientPersonas = [],
    } = await req.json();

    if (!projectId || !message) {
      return Response.json({ error: 'projectId and message are required' }, { status: 400 });
    }

    const settings = loadSettings();
    const selectedModel = model || settings.defaultModel || 'claude-5-sonnet-20260630';
    const currentAgentName = agentName || 'GENERAL_HELPER';

    // ── Gather state: server-side from Supabase, or client-sent fallback ──
    let history: HistoryRow[] = clientHistory;
    let allMemories: MemoryEntry[] = Array.isArray(clientMemories) ? clientMemories : [];
    let recalledMemories: MemoryEntry[] = [];
    let personas: { filename: string; content: string }[] = clientPersonas;
    let chatSummary: string | null = null;
    let userMessageId: string | null = null;
    let unsummarized: { role: string; content: string; timestamp: string }[] = [];

    if (auth && chatId) {
      const { db, token } = auth;

      // History: everything after the summary watermark, newest RECENT_N verbatim.
      const { data: chatRow } = await db
        .from('chats').select('summary, summary_upto').eq('id', chatId).single();
      chatSummary = chatRow?.summary ?? null;

      let historyQuery = db
        .from('memories')
        .select('id, role, content, timestamp, metadata')
        .eq('chat_id', chatId)
        .order('timestamp', { ascending: true });
      if (chatRow?.summary_upto) historyQuery = historyQuery.gt('timestamp', chatRow.summary_upto);
      const { data: rows } = await historyQuery;
      unsummarized = (rows || []).map(r => ({ role: r.role, content: r.content || '', timestamp: r.timestamp }));
      history = (rows || []).slice(-RECENT_MESSAGES);

      // Persist the user message BEFORE the model call so it survives failures.
      const { data: userRow } = await db.from('memories').insert({
        project_id: projectId,
        chat_id: chatId,
        content: message,
        role: 'user',
        metadata: attachments.length > 0 ? { attachments } : {},
        parent_id: rows && rows.length > 0 ? rows[rows.length - 1].id : null,
        timestamp: new Date().toISOString(),
      }).select('id').single();
      userMessageId = userRow?.id ?? null;

      // Personas from the DB, not the client.
      const { data: personaRows } = await db
        .from('project_personas').select('filename, content').eq('project_id', projectId);
      personas = personaRows || [];

      // MemPalace: full index always; hybrid recall for bodies once it grows.
      const { data: memRows } = await db
        .from('project_memories')
        .select('room_name, name, description, mem_type, fact_content')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });
      allMemories = memRows || [];

      if (allMemories.length >= RECALL_ALL_UNDER) {
        const recentUser = [...history].filter(h => h.role === 'user').slice(-2)
          .map(h => h.content || '').join('\n');
        const queryText = `${recentUser}\n${message}`.trim();
        const queryEmbedding = await embedQuery(queryText, token);
        if (queryEmbedding) {
          const { data: matches } = await db.rpc('match_memories', {
            p_project: projectId,
            p_query: queryEmbedding,
            p_terms: keywordTerms(queryText),
            p_k: RECALL_TOP_K,
          });
          if (Array.isArray(matches)) recalledMemories = matches;
        }
        if (recalledMemories.length === 0) {
          // Recall unavailable: fall back to the most recent memories.
          recalledMemories = allMemories.slice(-RECALL_TOP_K);
        }
      }
    }

    const memoriesContext = buildMemoriesContext(allMemories, recalledMemories);

    // ── Connector tool catalog (MCP), cached briefly to avoid per-message
    // handshakes with every registered server ──
    let toolsContext = '';
    if (auth) {
      const { data: connRows } = await auth.db.from('connectors').select('*').eq('enabled', true);
      const conns = (connRows || []) as Connector[];
      if (conns.length > 0) {
        const catalogs = await Promise.all(conns.map(async c => ({
          name: c.name,
          tools: await cachedConnectorTools(c),
        })));
        const lines: string[] = [];
        for (const cat of catalogs) {
          if (!cat.tools) { lines.push(`- ${cat.name}: OFFLINE (tool list unavailable)`); continue; }
          for (const t of cat.tools) {
            const params = t.inputSchema ? JSON.stringify((t.inputSchema as { properties?: object }).properties || {}) : '{}';
            lines.push(`- ${cat.name}.${t.name}: ${(t.description || '').replace(/\s+/g, ' ').slice(0, 200)} | args: ${params.slice(0, 300)}`);
          }
        }
        if (lines.length > 0) {
          toolsContext = `

# CONNECTED TOOLS (MCP CONNECTORS)
The operator has connected external services. Available tools:
${lines.join('\n')}

To use a tool, output on its own lines:
<USE_TOOL connector="[connector]" tool="[tool_name]">
{"arg": "value"}
</USE_TOOL>
The body must be a single JSON object matching the tool's args (use {} when no
args). The tag renders as a card with a RUN TOOL button; once the operator
approves, the result is added to the chat as a system message you will see on
your next turn. Never fabricate tool results — request the tool and wait.`;
        }
      }
    }

    // ── Agent-switch detection from history metadata ──
    const isNewSession = history.length === 0;
    let agentSwitched = false;
    const lastAssistantMem = [...history].reverse().find(m => m.role === 'assistant');
    if (lastAssistantMem && lastAssistantMem.metadata) {
      try {
        const meta = typeof lastAssistantMem.metadata === 'string'
          ? JSON.parse(lastAssistantMem.metadata)
          : lastAssistantMem.metadata;
        if ((meta.agentName || 'GENERAL_HELPER') !== currentAgentName) agentSwitched = true;
      } catch {}
    }

    // ── Compose the system prompt in OpenClaw Markdown format ──
    const activePersonas: Record<string, string> = {};
    personas.forEach(p => { activePersonas[p.filename] = p.content; });

    let openClawContext = '';
    if (currentAgentName !== 'GENERAL_HELPER') {
      const activeAgentPersonas: Record<string, string> = {
        'IDENTITY.md': agentPersonas?.identity_md || '',
        'SOUL.md': agentPersonas?.soul_md || '',
        'AGENTS.md': agentPersonas?.agents_md || '',
      };
      if (agentSwitched) {
        openClawContext += `\n\n[ SYSTEM NOTICE: AGENT SWAP DETECTED ]\nTHE USER HAS ASSIGNED THIS CHAT TO AGENT: ${currentAgentName.toUpperCase()}. DISREGARD PREVIOUS PERSONA RULES AND ADOPT THIS PROFILE IMMEDIATELY.\n`;
      }
      const needFullIdentity = isNewSession || agentSwitched;
      openClawContext += `\n\n# AGENT DESIGNATION: ${currentAgentName.toUpperCase()}\n`;
      if (needFullIdentity && activeAgentPersonas['IDENTITY.md'].trim()) {
        openClawContext += `\n# IDENTITY\n${activeAgentPersonas['IDENTITY.md']}\n`;
      }
      if (needFullIdentity && activeAgentPersonas['SOUL.md'].trim()) {
        openClawContext += `\n# SOUL\n${activeAgentPersonas['SOUL.md']}\n`;
      }
      if (activeAgentPersonas['AGENTS.md'].trim()) {
        openClawContext += `\n# AGENTS (RULES & CONSTRAINTS)\n${activeAgentPersonas['AGENTS.md']}\n`;
      }
    } else {
      const needFullIdentity = isNewSession || agentSwitched;
      const fileOrder = needFullIdentity
        ? ['IDENTITY.md', 'SOUL.md', 'AGENTS.md', 'WORKSPACE_INSTRUCTIONS.md']
        : ['AGENTS.md', 'WORKSPACE_INSTRUCTIONS.md'];
      fileOrder.forEach(filename => {
        const content = activePersonas[filename];
        if (content && content.trim()) {
          openClawContext += `\n\n# ${filename.replace('.md', '').toUpperCase()}\n${content}\n`;
        }
      });
    }

    const summaryContext = chatSummary
      ? `\n\n<CONVERSATION_SUMMARY>\nOlder messages in this chat, compressed. The verbatim originals remain stored; ask the operator if a detail seems missing.\n${chatSummary}\n</CONVERSATION_SUMMARY>`
      : '';

    const proactiveCapabilities = `
# SYSTEM CAPABILITIES (PROACTIVE TOOLS)
You are a persistent agent inside Memgine, a project workspace with long-term memory
(the Memory Palace) and editable persona files. You have XML tags that render as
interactive cards in the UI; the operator must approve each card before anything is
saved, so use them proactively but precisely. Place tags on their own lines and never
nest them (OPTION inside ASK_USER is the one exception).

To ask the operator a direct clarifying question when a decision is genuinely theirs
(scope, taste, anything irreversible), output:
<ASK_USER>
[One specific question, answerable in a sentence]
<OPTION label="[Short label, 1-5 words]">[One-line description of what this choice means]</OPTION>
<OPTION label="[Short label]">[One-line description]</OPTION>
</ASK_USER>
Always include 2-4 OPTION tags covering the most likely answers; they render as
clickable choices. If you recommend one, put it first and end its label with
"(Recommended)". The UI always offers an "Other" free-text choice, so never add a
catch-all option like "Something else". OPTION tags are the one permitted case of
nesting and are only valid inside ASK_USER.
Be resourceful first: check the Memory Palace context and chat history before asking.

To propose a change to your configuration files (IDENTITY.md, SOUL.md, AGENTS.md),
output the full replacement content (not a diff):
<PROPOSE_EDIT file="[FILENAME]">
[New markdown content for the file]
</PROPOSE_EDIT>

To store a new long-term memory in the Memory Palace (rooms: GENERAL, DATABASE,
FRONTEND, APIS, ARCHITECTURE), output:
<ADD_FACT room="[ROOM_NAME]" name="[kebab-case-slug]" type="[user|feedback|project|reference]" description="[one-line summary used to judge relevance]">
[The fact. Small and atomic. Link related memories inline with [[their-name]].]
</ADD_FACT>
Types: user = who the operator is (role, expertise, preferences); feedback =
guidance the operator gave on how to work — body must include "**Why:**" and
"**How to apply:**" lines; project = ongoing work, goals, or constraints not
derivable from the chat (convert relative dates to absolute); reference =
pointers to external resources (URLs, dashboards, tickets).
When the operator says "remember this", always respond with an <ADD_FACT> tag.
Before adding, check MEMORY_PALACE_CONTEXT for an existing memory that covers
it; if one does, say so and propose superseding it instead of duplicating. Do
not save what the chat history already shows or what only matters this session.
Reusing an existing memory's name intentionally REPLACES that memory.

To define a new specialized sub-agent the operator can deploy, output:
<CREATE_AGENT name="[AGENT_NAME]">
[Agent description and rules]
</CREATE_AGENT>

The operator can switch the underlying AI model at any time; your persona files and
memory persist across model swaps. Never invent project facts: the Memory Palace and
chat history are the source of truth.
`;

    const systemPrompt: ChatMessage = {
      role: 'system',
      content: `You are an AI assistant for the project "${projectName || projectId}". You have access to the conversation history for this chat (older parts may arrive as a summary). Be helpful, precise, and remember prior context from this project's sessions.${openClawContext}${summaryContext}${memoriesContext}${proactiveCapabilities}${toolsContext}`,
    };

    // Resolve the user message content: text, plus vision parts for images and
    // inlined bodies for text-like files (mempalace-style: originals stay in
    // storage verbatim; the model gets what it can actually read).
    let userContent: string | ContentPart[] = message;
    const atts = (attachments as Attachment[]).filter(a => a && a.path && a.name);
    if (auth && atts.length > 0) {
      const { db } = auth;
      const parts: ContentPart[] = [];
      let inlined = '';
      const notes: string[] = [];
      for (const att of atts) {
        if (att.kind === 'image') {
          const { data } = await db.storage.from(ATTACHMENTS_BUCKET).createSignedUrl(att.path, 600);
          if (data?.signedUrl) parts.push({ type: 'image_url', image_url: { url: data.signedUrl } });
          else notes.push(`[attached image unavailable: ${att.name}]`);
        } else if (att.kind === 'text') {
          const { data } = await db.storage.from(ATTACHMENTS_BUCKET).download(att.path);
          if (data) {
            const body = (await data.text()).slice(0, 30000);
            inlined += `\n\n[FILE: ${att.name}]\n\`\`\`\n${body}\n\`\`\``;
          } else {
            notes.push(`[attached file unavailable: ${att.name}]`);
          }
        } else {
          notes.push(`[attached ${att.kind}: ${att.name} (${att.mime})]`);
        }
      }
      const text = [message, inlined, notes.join('\n')].filter(Boolean).join('\n');
      userContent = parts.length > 0 ? [{ type: 'text', text }, ...parts] : text;
    } else if (atts.length > 0) {
      userContent = `${message}\n` + atts.map(a => `[attached ${a.kind}: ${a.name}]`).join('\n');
    }

    const formattedHistory: ChatMessage[] = (history as HistoryRow[]).map(m => {
      let content = m.content || m.text || '';
      const meta = (m.metadata && typeof m.metadata === 'object' ? m.metadata : null) as { attachments?: Attachment[] } | null;
      if (meta?.attachments?.length) {
        content += '\n' + meta.attachments.map(a => `[attached ${a.kind}: ${a.name}]`).join('\n');
      }
      return { role: m.role, content };
    });
    if (formattedHistory.length === 0 || formattedHistory[formattedHistory.length - 1].content !== message) {
      formattedHistory.push({ role: 'user', content: userContent });
    } else {
      formattedHistory[formattedHistory.length - 1].content = userContent;
    }
    const messagesForAI: ChatMessage[] = [systemPrompt, ...formattedHistory];

    // ── Stream the response as SSE; persist the assistant message at the end ──
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        let fullText = '';
        try {
          for await (const delta of streamProvider(messagesForAI, selectedModel, settings.apiKeys, { webSearch: webSearch === true })) {
            fullText += delta;
            send({ delta });
          }

          if (!fullText.trim()) {
            send({ error: 'Model returned an empty response. Retry or switch models.' });
          } else if (auth && chatId) {
            const { db } = auth;
            await db.from('memories').insert({
              project_id: projectId,
              chat_id: chatId,
              content: fullText,
              role: 'assistant',
              metadata: { model: selectedModel, agentName: currentAgentName },
              parent_id: userMessageId,
              timestamp: new Date().toISOString(),
            });
            // +2 for the exchange we just persisted.
            await maybeFoldSummary(
              db, chatId, chatSummary,
              [...unsummarized,
                { role: 'user', content: message, timestamp: new Date().toISOString() },
                { role: 'assistant', content: fullText, timestamp: new Date().toISOString() }],
              selectedModel, settings.apiKeys
            );
          }

          send({ done: true, model: selectedModel, agentName: currentAgentName });
        } catch (error) {
          send({ error: error instanceof Error ? error.message : 'Unknown error' });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

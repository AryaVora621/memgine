import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { loadSettings } from '@/lib/settings';
import { callProvider, type ChatMessage } from '@/lib/providers';

// The route proxies paid AI providers, so it must not be callable anonymously.
// Callers pass their Supabase access token; we verify it against the project.
async function verifyCaller(req: Request): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return true; // Supabase-less local setup: nothing to verify against
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const supabase = createClient(url, anonKey);
  const { data, error } = await supabase.auth.getUser(token);
  return !error && !!data.user;
}

export async function POST(req: Request) {
  try {
    if (!(await verifyCaller(req))) {
      return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
    }
    const {
      projectId,
      projectName,
      message,
      history = [], 
      model, 
      projectMemories, 
      projectPersonas, 
      agentName, 
      agentPersonas 
    } = await req.json();

    if (!projectId || !message) {
      return NextResponse.json({ error: 'projectId and message are required' }, { status: 400 });
    }

    const settings = loadSettings();

    // Format MemPalace structured memories context
    let memoriesContext = '';
    if (projectMemories && Array.isArray(projectMemories) && projectMemories.length > 0) {
      memoriesContext = `\n\n<MEMORY_PALACE_CONTEXT>\n`;
      const rooms: Record<string, string[]> = {};
      projectMemories.forEach((pm: { room_name?: string; fact_content: string }) => {
        const roomName = pm.room_name || 'GENERAL';
        if (!rooms[roomName]) rooms[roomName] = [];
        rooms[roomName].push(pm.fact_content);
      });
      for (const [room, facts] of Object.entries(rooms)) {
        memoriesContext += `[ROOM: ${room.toUpperCase()}]\n`;
        facts.forEach(fact => {
          memoriesContext += `- ${fact}\n`;
        });
      }
      memoriesContext += `</MEMORY_PALACE_CONTEXT>`;
    }

    // Detect if agent changed mid-session based on history metadata
    const isNewSession = history.length === 0;
    let agentSwitched = false;
    const lastAssistantMem = [...history].reverse().find(m => m.role === 'assistant');
    const currentAgentName = agentName || 'GENERAL_HELPER';
    
    if (lastAssistantMem && lastAssistantMem.metadata) {
      try {
        const meta = typeof lastAssistantMem.metadata === 'string' ? JSON.parse(lastAssistantMem.metadata) : lastAssistantMem.metadata;
        const lastAgentName = meta.agentName || 'GENERAL_HELPER';
        if (lastAgentName !== currentAgentName) {
          agentSwitched = true;
        }
      } catch {}
    }

    // Build OpenClaw unified identity context from Supabase Personas
    const activePersonas: Record<string, string> = {};
    if (projectPersonas && Array.isArray(projectPersonas)) {
      projectPersonas.forEach((p: { filename: string; content: string }) => {
        activePersonas[p.filename] = p.content;
      });
    }

    // Compose the system prompt in OpenClaw Markdown format
    let openClawContext = '';
    
    if (currentAgentName !== 'GENERAL_HELPER') {
      // ── Specific Agent Context ──
      const activeAgentPersonas: Record<string, string> = {
        'IDENTITY.md': agentPersonas?.identity_md || '',
        'SOUL.md': agentPersonas?.soul_md || '',
        'AGENTS.md': agentPersonas?.agents_md || '',
      };

      if (agentSwitched) {
        openClawContext += `\n\n[ SYSTEM NOTICE: AGENT SWAP DETECTED ]\nTHE USER HAS ASSIGNED THIS CHAT TO AGENT: ${currentAgentName.toUpperCase()}. DISREGARD PREVIOUS PERSONA RULES AND ADOPT THIS PROFILE IMMEDIATELY.\n`;
      }

      // Token optimization: Send IDENTITY & SOUL only on session start / agent swap
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
      // ── General Workspace Context ──
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

    const proactiveCapabilities = `
# SYSTEM CAPABILITIES (PROACTIVE TOOLS)
You are a persistent agent inside Memgine, a project workspace with long-term memory
(the Memory Palace) and editable persona files. You have XML tags that render as
interactive cards in the UI; the operator must approve each card before anything is
saved, so use them proactively but precisely. Place tags on their own lines and never
nest them.

To ask the operator a direct clarifying question when a decision is genuinely theirs
(scope, taste, anything irreversible), output:
<ASK_USER>
[One specific question, answerable in a sentence]
</ASK_USER>
Be resourceful first: check the Memory Palace context and chat history before asking.

To propose a change to your configuration files (IDENTITY.md, SOUL.md, AGENTS.md),
output the full replacement content (not a diff):
<PROPOSE_EDIT file="[FILENAME]">
[New markdown content for the file]
</PROPOSE_EDIT>

To store a new long-term fact in the Memory Palace (rooms: GENERAL, DATABASE,
FRONTEND, APIS, ARCHITECTURE; prefer small atomic facts), output:
<ADD_FACT room="[ROOM_NAME]">
[Fact content]
</ADD_FACT>
When the operator says "remember this", always respond with an <ADD_FACT> tag.

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
      content: `You are an AI assistant for the project "${projectName || projectId}". You have access to the full conversation history for this project. Be helpful, precise, and remember prior context from this project's sessions.${openClawContext}${memoriesContext}${proactiveCapabilities}`,
    };

    const formattedHistory: ChatMessage[] = history.map((m: { role: ChatMessage['role']; content?: string; text?: string }) => ({
      role: m.role,
      content: m.content || m.text || ''
    }));

    if (formattedHistory.length === 0 || formattedHistory[formattedHistory.length - 1].content !== message) {
      formattedHistory.push({ role: 'user', content: message });
    }

    const messagesForAI: ChatMessage[] = [systemPrompt, ...formattedHistory];

    // Call the actual AI provider
    const selectedModel = model || settings.defaultModel || 'claude-5-sonnet-20260630';
    const result = await callProvider(messagesForAI, selectedModel, settings.apiKeys);

    return NextResponse.json({
      success: true,
      response: result.text,
      model: result.model,
      tokensUsed: result.tokensUsed,
      agentName: currentAgentName
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

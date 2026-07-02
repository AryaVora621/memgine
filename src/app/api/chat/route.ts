import { NextResponse } from 'next/server';
import { loadSettings } from '@/lib/settings';
import { callProvider, type ChatMessage } from '@/lib/providers';

export async function POST(req: Request) {
  try {
    const { 
      projectId, 
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
      projectMemories.forEach((pm: any) => {
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
      projectPersonas.forEach((p: any) => {
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
# SYSTEM CAPABILITIES (PROACTIVE SELF-IMPROVEMENT)
You have the ability to proactively manage your own identity, rules, skills, and memory palace. 
To propose a change to your configuration files (e.g., IDENTITY.md, SOUL.md, AGENTS.md), output the following in your response:
<PROPOSE_EDIT file="[FILENAME]">
[New markdown content for the file]
</PROPOSE_EDIT>

To proactively store a new fact in the Memory Palace to help you remember context for the long term, output:
<ADD_FACT room="[ROOM_NAME]">
[Fact content]
</ADD_FACT>

To define a new sub-agent that you can delegate to later, output:
<CREATE_AGENT name="[AGENT_NAME]">
[Agent description and rules]
</CREATE_AGENT>
`;

    const systemPrompt: ChatMessage = {
      role: 'system',
      content: `You are an AI assistant for the project "${projectId}". You have access to the full conversation history for this project. Be helpful, precise, and remember prior context from this project's sessions.${openClawContext}${memoriesContext}${proactiveCapabilities}`,
    };

    const formattedHistory: ChatMessage[] = history.map((m: any) => ({
      role: m.role,
      content: m.content || m.text || ''
    }));

    if (formattedHistory.length === 0 || formattedHistory[formattedHistory.length - 1].content !== message) {
      formattedHistory.push({ role: 'user', content: message });
    }

    const messagesForAI: ChatMessage[] = [systemPrompt, ...formattedHistory];

    // Call the actual AI provider
    const selectedModel = model || settings.defaultModel || 'claude-sonnet-4-20250514';
    const result = await callProvider(messagesForAI, selectedModel, settings.apiKeys);

    return NextResponse.json({
      success: true,
      response: result.text,
      model: result.model,
      tokensUsed: result.tokensUsed,
      agentName: currentAgentName
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message || 'Unknown error',
    }, { status: 500 });
  }
}

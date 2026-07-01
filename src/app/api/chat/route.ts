import { NextResponse } from 'next/server';
import { getMemoryStore } from '@/lib/memoryStore';
import { loadSettings } from '@/lib/settings';
import { callProvider, type ChatMessage } from '@/lib/providers';

export async function POST(req: Request) {
  try {
    const { projectId, message, model, projectMemories, projectPersonas } = await req.json();

    if (!projectId || !message) {
      return NextResponse.json({ error: 'projectId and message are required' }, { status: 400 });
    }

    const settings = loadSettings();
    const memory = getMemoryStore(projectId);

    // Save user message to memory verbatim (MemPalace pattern)
    const userMemId = memory.addMemory(projectId, message, 'user');

    // Build conversation history from memory for context
    const recentMemories = memory.getMemories(projectId, 30);
    const history: ChatMessage[] = recentMemories
      .reverse() // oldest first
      .map(m => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      }));

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

    // Build OpenClaw unified identity context (local override + cloud fallback)
    const activePersonas: Record<string, string> = {};
    
    // 1. Populate with cloud synced personas first
    if (projectPersonas && Array.isArray(projectPersonas)) {
      projectPersonas.forEach((p: any) => {
        activePersonas[p.filename] = p.content;
      });
    }

    // 2. Override with local files if running locally
    const proj = settings.projects.find(p => p.id === projectId);
    if (proj && proj.path && process.env.VERCEL !== '1') {
      const fs = require('fs');
      const path = require('path');
      const targetFiles = ['IDENTITY.md', 'SOUL.md', 'AGENTS.md'];
      
      targetFiles.forEach(file => {
        const filePath = path.join(proj.path, file);
        if (fs.existsSync(filePath)) {
          try {
            activePersonas[file] = fs.readFileSync(filePath, 'utf-8');
          } catch {}
        }
      });

      // Also support custom fallback workspace instructions (.memgineprompt, etc.)
      const promptFiles = ['.memgineprompt', '.claudeprompt', '.cursorrules', 'instructions.md'];
      for (const file of promptFiles) {
        const filePath = path.join(proj.path, file);
        if (fs.existsSync(filePath)) {
          try {
            activePersonas['WORKSPACE_INSTRUCTIONS.md'] = fs.readFileSync(filePath, 'utf-8');
            break;
          } catch {}
        }
      }
    }

    // 3. Compose the prompt in OpenClaw Markdown format
    let openClawContext = '';
    const fileOrder = ['IDENTITY.md', 'SOUL.md', 'AGENTS.md', 'WORKSPACE_INSTRUCTIONS.md'];
    fileOrder.forEach(filename => {
      const content = activePersonas[filename];
      if (content && content.trim()) {
        openClawContext += `\n\n# ${filename.replace('.md', '').toUpperCase()}\n${content}\n`;
      }
    });

    const systemPrompt: ChatMessage = {
      role: 'system',
      content: `You are an AI assistant for the project "${projectId}". You have access to the full conversation history for this project. Be helpful, precise, and remember prior context from this project's sessions.${openClawContext}${memoriesContext}`,
    };

    const messagesForAI: ChatMessage[] = [systemPrompt, ...history];

    // Call the actual AI provider
    const selectedModel = model || settings.defaultModel || 'claude-sonnet-4-20250514';
    const result = await callProvider(messagesForAI, selectedModel, settings.apiKeys);

    // Save AI response to memory
    const assistantMemId = memory.addMemory(
      projectId,
      result.text,
      'assistant',
      { model: result.model, tokensUsed: result.tokensUsed },
      userMemId
    );

    return NextResponse.json({
      success: true,
      response: result.text,
      model: result.model,
      tokensUsed: result.tokensUsed,
      userMessageId: userMemId,
      assistantMessageId: assistantMemId,
    });  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message || 'Unknown error',
    }, { status: 500 });
  }
}

/**
 * AI Provider abstraction layer.
 * Routes chat requests to the correct provider based on model selection.
 * Supports: OpenRouter, Anthropic, OpenAI, and local CLI (agy/claude).
 */

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ProviderResponse {
  text: string;
  model: string;
  tokensUsed?: number;
}

interface ApiKeys {
  openrouter?: string;
  anthropic?: string;
  openai?: string;
  google?: string;
}

// ── Model → Provider mapping ──
// Google models route through OpenRouter BYOK (google/* ids fall through to the
// openrouter default); the native callGoogle path stays for direct-key setups.
const MODEL_PROVIDER_MAP: Record<string, string> = {
  'claude-5-sonnet-20260630': 'anthropic',
  'openrouter/auto': 'openrouter',
  'nvidia/nemotron-3-ultra-550b-a55b:free': 'openrouter',
  'google/gemma-4-31b-it:free': 'openrouter',
  'nousresearch/hermes-3-llama-3.1-405b:free': 'openrouter',
  'openai/gpt-oss-120b:free': 'openrouter',
  'agy-local': 'local',
  'claude-local': 'local',
};

// ── OpenRouter ──
async function callOpenRouter(messages: ChatMessage[], model: string, apiKey: string): Promise<ProviderResponse> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3030',
      'X-Title': 'Notebook',
    },
    body: JSON.stringify({
      model,
      messages,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  const msg = choice?.message;
  // Content can be a plain string or an array of typed parts depending on the provider
  let text = '';
  if (typeof msg?.content === 'string') {
    text = msg.content;
  } else if (Array.isArray(msg?.content)) {
    text = msg.content.map((p: { text?: string }) => p?.text || '').join('');
  }
  if (!text && typeof msg?.reasoning === 'string') {
    text = msg.reasoning;
  }
  if (!text) {
    const detail = data.error?.message || choice?.error?.message || choice?.finish_reason;
    throw new Error(`OpenRouter returned no content${detail ? ` (${detail})` : ''}. Retry or switch models.`);
  }
  return {
    text,
    model: data.model || model,
    tokensUsed: data.usage?.total_tokens,
  };
}

// ── Anthropic ──
async function callAnthropic(messages: ChatMessage[], model: string, apiKey: string): Promise<ProviderResponse> {
  // Separate system messages from conversation
  const systemMsgs = messages.filter(m => m.role === 'system');
  const convMsgs = messages.filter(m => m.role !== 'system');

  const body: {
    model: string;
    max_tokens: number;
    messages: { role: string; content: string }[];
    system?: { type: string; text: string; cache_control: { type: string } }[];
  } = {
    model,
    max_tokens: 4096,
    messages: convMsgs.map(m => ({ role: m.role, content: m.content })),
  };

  if (systemMsgs.length > 0) {
    body.system = [
      {
        type: 'text',
        text: systemMsgs.map(m => m.content).join('\n'),
        cache_control: { type: 'ephemeral' }
      }
    ];
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = data.content?.map((c: { text?: string }) => c.text ?? '').join('') || '';
  return {
    text,
    model: data.model || model,
    tokensUsed: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
  };
}

// ── OpenAI ──
async function callOpenAI(messages: ChatMessage[], model: string, apiKey: string): Promise<ProviderResponse> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return {
    text: data.choices?.[0]?.message?.content || '',
    model: data.model || model,
    tokensUsed: data.usage?.total_tokens,
  };
}

// ── Google (Gemini via OpenAI-compatible endpoint) ──
async function callGoogle(messages: ChatMessage[], model: string, apiKey: string): Promise<ProviderResponse> {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google AI error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return {
    text: data.choices?.[0]?.message?.content || '',
    model: data.model || model,
    tokensUsed: data.usage?.total_tokens,
  };
}

// ── Main router ──
export async function callProvider(
  messages: ChatMessage[],
  model: string,
  apiKeys: ApiKeys
): Promise<ProviderResponse> {
  const provider = MODEL_PROVIDER_MAP[model] || 'openrouter';

  switch (provider) {
    case 'anthropic': {
      const key = apiKeys.anthropic || process.env.ANTHROPIC_API_KEY || process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY;
      if (!key) throw new Error('ANTHROPIC API KEY NOT CONFIGURED. GO TO SETTINGS OR SET ENV VARIABLE.');
      return callAnthropic(messages, model, key);
    }
    case 'openai': {
      const key = apiKeys.openai || process.env.OPENAI_API_KEY || process.env.NEXT_PUBLIC_OPENAI_API_KEY;
      if (!key) throw new Error('OPENAI API KEY NOT CONFIGURED. GO TO SETTINGS OR SET ENV VARIABLE.');
      return callOpenAI(messages, model, key);
    }
    case 'google': {
      const key = apiKeys.google || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
      if (!key) throw new Error('GOOGLE GEMINI API KEY NOT CONFIGURED. GO TO SETTINGS OR SET ENV VARIABLE.');
      return callGoogle(messages, model, key);
    }
    case 'local':
      return callLocalCLI(messages, model);
    case 'openrouter':
    default: {
      const key = apiKeys.openrouter || process.env.OPENROUTER_API_KEY || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY;
      if (!key && model !== 'agy-local' && model !== 'claude-local') {
        throw new Error('OPENROUTER API KEY NOT CONFIGURED. GO TO SETTINGS OR SET ENV VARIABLE.');
      }
      return callOpenRouter(messages, model, key || '');
    }
  }
}

// ── Streaming ──
// streamProvider yields text deltas as they arrive. Local CLI models cannot
// stream, so they yield their whole response as one chunk.

async function* sseDataLines(res: Response): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data:')) yield trimmed.slice(5).trim();
    }
  }
}

// OpenRouter, OpenAI, and Google all speak the OpenAI chat-completions SSE dialect.
async function* streamOpenAICompatible(
  url: string,
  messages: ChatMessage[],
  model: string,
  headers: Record<string, string>
): AsyncGenerator<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Provider error ${res.status}: ${err}`);
  }
  for await (const data of sseDataLines(res)) {
    if (data === '[DONE]') return;
    try {
      const json = JSON.parse(data);
      const delta = json.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta) yield delta;
      if (json.error?.message) throw new Error(json.error.message);
    } catch (e) {
      if (e instanceof SyntaxError) continue; // keep-alive / partial frames
      throw e;
    }
  }
}

async function* streamAnthropic(messages: ChatMessage[], model: string, apiKey: string): AsyncGenerator<string> {
  const systemMsgs = messages.filter(m => m.role === 'system');
  const convMsgs = messages.filter(m => m.role !== 'system');
  const body: Record<string, unknown> = {
    model,
    max_tokens: 4096,
    stream: true,
    messages: convMsgs.map(m => ({ role: m.role, content: m.content })),
  };
  if (systemMsgs.length > 0) {
    body.system = [{
      type: 'text',
      text: systemMsgs.map(m => m.content).join('\n'),
      cache_control: { type: 'ephemeral' },
    }];
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic error ${res.status}: ${err}`);
  }
  for await (const data of sseDataLines(res)) {
    try {
      const json = JSON.parse(data);
      if (json.type === 'content_block_delta' && typeof json.delta?.text === 'string') {
        yield json.delta.text;
      }
      if (json.type === 'error') throw new Error(json.error?.message || 'Anthropic stream error');
    } catch (e) {
      if (e instanceof SyntaxError) continue;
      throw e;
    }
  }
}

export async function* streamProvider(
  messages: ChatMessage[],
  model: string,
  apiKeys: ApiKeys
): AsyncGenerator<string> {
  const provider = MODEL_PROVIDER_MAP[model] || 'openrouter';

  switch (provider) {
    case 'anthropic': {
      const key = apiKeys.anthropic || process.env.ANTHROPIC_API_KEY || process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY;
      if (!key) throw new Error('ANTHROPIC API KEY NOT CONFIGURED. GO TO SETTINGS OR SET ENV VARIABLE.');
      yield* streamAnthropic(messages, model, key);
      return;
    }
    case 'openai': {
      const key = apiKeys.openai || process.env.OPENAI_API_KEY || process.env.NEXT_PUBLIC_OPENAI_API_KEY;
      if (!key) throw new Error('OPENAI API KEY NOT CONFIGURED. GO TO SETTINGS OR SET ENV VARIABLE.');
      yield* streamOpenAICompatible('https://api.openai.com/v1/chat/completions', messages, model, {
        'Authorization': `Bearer ${key}`,
      });
      return;
    }
    case 'google': {
      const key = apiKeys.google || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
      if (!key) throw new Error('GOOGLE GEMINI API KEY NOT CONFIGURED. GO TO SETTINGS OR SET ENV VARIABLE.');
      yield* streamOpenAICompatible('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', messages, model, {
        'Authorization': `Bearer ${key}`,
      });
      return;
    }
    case 'local': {
      const result = await callLocalCLI(messages, model);
      yield result.text;
      return;
    }
    case 'openrouter':
    default: {
      const key = apiKeys.openrouter || process.env.OPENROUTER_API_KEY || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY;
      if (!key) throw new Error('OPENROUTER API KEY NOT CONFIGURED. GO TO SETTINGS OR SET ENV VARIABLE.');
      yield* streamOpenAICompatible('https://openrouter.ai/api/v1/chat/completions', messages, model, {
        'Authorization': `Bearer ${key}`,
        'HTTP-Referer': 'http://localhost:3030',
        'X-Title': 'Notebook',
      });
      return;
    }
  }
}

import { execSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';

async function callLocalCLI(messages: ChatMessage[], model: string): Promise<ProviderResponse> {
  const isAgy = model === 'agy-local';
  const prompt = messages.map(m => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n');
  
  try {
    const tmpFile = path.join(os.tmpdir(), `memgine_local_${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, prompt, 'utf-8');
    
    // We assume the cli supports reading from stdin or passing file contents
    const cmd = isAgy 
      ? `agy -p "$(cat ${tmpFile})"` 
      : `claude -p "$(cat ${tmpFile})"`;
      
    const output = execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    fs.unlinkSync(tmpFile);
    
    return {
      text: output,
      model,
      tokensUsed: 0
    };
  } catch (err) {
    const execErr = err as { stderr?: string; message?: string };
    throw new Error(`Local CLI error: ${execErr.stderr || execErr.message}`);
  }
}

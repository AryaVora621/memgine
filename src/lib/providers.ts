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
const MODEL_PROVIDER_MAP: Record<string, string> = {
  'claude-sonnet-4-20250514': 'anthropic',
  'claude-4-opus': 'anthropic',
  'gpt-4.1': 'openai',
  'gpt-4o': 'openai',
  'gemini-2.5-pro': 'google',
  'openrouter/auto': 'openrouter',
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
      model: model === 'openrouter/auto' ? 'anthropic/claude-sonnet-4-20250514' : model,
      messages,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return {
    text: data.choices?.[0]?.message?.content || '',
    model: data.model || model,
    tokensUsed: data.usage?.total_tokens,
  };
}

// ── Anthropic ──
async function callAnthropic(messages: ChatMessage[], model: string, apiKey: string): Promise<ProviderResponse> {
  // Separate system messages from conversation
  const systemMsgs = messages.filter(m => m.role === 'system');
  const convMsgs = messages.filter(m => m.role !== 'system');

  const body: any = {
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
  const text = data.content?.map((c: any) => c.text).join('') || '';
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
    case 'openrouter':
    default: {
      const key = apiKeys.openrouter || process.env.OPENROUTER_API_KEY || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY;
      if (!key) throw new Error('OPENROUTER API KEY NOT CONFIGURED. GO TO SETTINGS OR SET ENV VARIABLE.');
      return callOpenRouter(messages, model, key);
    }
  }
}

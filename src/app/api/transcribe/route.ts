import { loadSettings } from '@/lib/settings';
import { authedClient } from '@/lib/serverSupabase';

// Voice input: forwards base64 audio to OpenRouter's unified STT endpoint
// (JSON body, not OpenAI-style multipart). Voxtral is primary because the
// OpenAI transcribe providers rate-limit aggressively on shared keys.
const STT_MODELS = ['mistralai/voxtral-mini-transcribe', 'openai/whisper-1'];

export async function POST(req: Request) {
  try {
    const auth = await authedClient(req);
    if (auth === 'unauthorized') {
      return Response.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
    }

    const settings = loadSettings();
    const key = settings.apiKeys?.openrouter || process.env.OPENROUTER_API_KEY || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY;
    if (!key) {
      return Response.json({ success: false, error: 'OPENROUTER API KEY NOT CONFIGURED.' }, { status: 500 });
    }

    const { data, format } = await req.json();
    if (!data || !format) {
      return Response.json({ success: false, error: 'data (base64 audio) and format are required' }, { status: 400 });
    }

    let lastError = 'No STT model succeeded.';
    for (const model of STT_MODELS) {
      const res = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input_audio: { data, format } }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.text !== undefined) {
        return Response.json({ success: true, text: body.text, model });
      }
      lastError = body?.error?.message || `STT failed (${res.status})`;
    }
    return Response.json({ success: false, error: lastError }, { status: 502 });
  } catch (error) {
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

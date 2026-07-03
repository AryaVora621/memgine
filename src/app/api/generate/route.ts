import { type SupabaseClient } from '@supabase/supabase-js';
import { loadSettings } from '@/lib/settings';
import { authedClient } from '@/lib/serverSupabase';
import { ATTACHMENTS_BUCKET, type Attachment } from '@/lib/attachments';

// Generation skills, all via OpenRouter's unified media APIs on the same key:
//   image -> POST /api/v1/images                (sync, base64 out)
//   audio -> POST /api/v1/audio/speech          (sync TTS, raw bytes out)
//   video -> POST /api/v1/videos                (async job; client polls here)
// Results are stored in the attachments bucket and persisted as assistant
// messages, so generations live in chat history like any other message.

const IMAGE_MODEL = 'google/gemini-3.1-flash-image-preview';
// Gemini TTS only emits raw PCM (24kHz 16-bit mono), so we wrap it in a WAV
// header for browser playback.
const TTS_MODEL = 'google/gemini-3.1-flash-tts-preview';
const TTS_VOICE = 'Kore';
const TTS_SAMPLE_RATE = 24000;
const VIDEO_MODEL_PREFERENCE = /seedance|wan/i;

const OR_BASE = 'https://openrouter.ai/api/v1';

function openRouterKey(): string {
  const settings = loadSettings();
  const key = settings.apiKeys?.openrouter || process.env.OPENROUTER_API_KEY || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER API KEY NOT CONFIGURED.');
  return key;
}

function orHeaders(): Record<string, string> {
  return {
    'Authorization': `Bearer ${openRouterKey()}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'http://localhost:3030',
    'X-Title': 'Notebook',
  };
}

async function storeAttachment(
  db: SupabaseClient,
  projectId: string,
  chatId: string,
  bytes: ArrayBuffer,
  name: string,
  mime: string,
  kind: Attachment['kind']
): Promise<Attachment> {
  const path = `${projectId}/${chatId}/${Date.now()}-${name}`;
  const { error } = await db.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(path, bytes, { contentType: mime });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return { path, name, mime, size: bytes.byteLength, kind };
}

async function insertMessage(
  db: SupabaseClient,
  projectId: string,
  chatId: string,
  role: 'user' | 'assistant',
  content: string,
  metadata: Record<string, unknown>,
  parentId: string | null = null
): Promise<string | null> {
  const { data } = await db.from('memories').insert({
    project_id: projectId,
    chat_id: chatId,
    content,
    role,
    metadata,
    parent_id: parentId,
    timestamp: new Date().toISOString(),
  }).select('id').single();
  return data?.id ?? null;
}

async function generateImage(prompt: string): Promise<{ bytes: ArrayBuffer; mime: string; ext: string }> {
  const res = await fetch(`${OR_BASE}/images`, {
    method: 'POST',
    headers: orHeaders(),
    body: JSON.stringify({ model: IMAGE_MODEL, prompt }),
  });
  if (!res.ok) throw new Error(`Image generation failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('Image generation returned no image data.');
  const mime = data.data?.[0]?.media_type || 'image/png';
  const bytes = Buffer.from(b64, 'base64');
  return { bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), mime, ext: mime.split('/')[1]?.split('+')[0] || 'png' };
}

function pcmToWav(pcm: ArrayBuffer, sampleRate: number, channels = 1, bitsPerSample = 16): ArrayBuffer {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.byteLength, 40);
  const out = new Uint8Array(44 + pcm.byteLength);
  out.set(header, 0);
  out.set(new Uint8Array(pcm), 44);
  return out.buffer;
}

async function generateSpeech(prompt: string): Promise<ArrayBuffer> {
  const res = await fetch(`${OR_BASE}/audio/speech`, {
    method: 'POST',
    headers: orHeaders(),
    body: JSON.stringify({ model: TTS_MODEL, input: prompt, voice: TTS_VOICE, response_format: 'pcm' }),
  });
  if (!res.ok) throw new Error(`Speech generation failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return pcmToWav(await res.arrayBuffer(), TTS_SAMPLE_RATE);
}

async function pickVideoModel(): Promise<string> {
  const res = await fetch(`${OR_BASE}/videos/models`, { headers: orHeaders() });
  if (!res.ok) throw new Error(`Could not list video models (${res.status}).`);
  const data = await res.json();
  const models: { id?: string }[] = data.data || data.models || [];
  const ids = models.map(m => m.id).filter((id): id is string => !!id);
  if (ids.length === 0) throw new Error('No video models available on OpenRouter.');
  return ids.find(id => VIDEO_MODEL_PREFERENCE.test(id)) || ids[0];
}

export async function POST(req: Request) {
  try {
    const auth = await authedClient(req);
    if (auth === 'unauthorized' || auth === null) {
      // Generation writes to storage + chat history, so it requires Supabase.
      return Response.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
    }
    const { db } = auth;

    const { projectId, chatId, kind, prompt, jobId } = await req.json();
    if (!projectId || !chatId || !kind) {
      return Response.json({ success: false, error: 'projectId, chatId, and kind are required' }, { status: 400 });
    }

    // ── Video polling leg: check the job, store + persist when done ──
    if (kind === 'video' && jobId) {
      const res = await fetch(`${OR_BASE}/videos/${jobId}`, { headers: orHeaders() });
      if (!res.ok) throw new Error(`Video status check failed (${res.status}).`);
      const job = await res.json();
      const status: string = job.status || job.data?.status || 'unknown';
      if (['failed', 'cancelled', 'error'].includes(status)) {
        return Response.json({ success: false, error: `Video job ${status}: ${job.error?.message || 'no detail'}` });
      }
      const urls: string[] = job.unsigned_urls || job.data?.unsigned_urls || [];
      if (status !== 'completed' || urls.length === 0) {
        return Response.json({ success: true, pending: true, status });
      }
      const videoRes = await fetch(urls[0]);
      if (!videoRes.ok) throw new Error('Could not download generated video.');
      const attachment = await storeAttachment(
        db, projectId, chatId, await videoRes.arrayBuffer(), 'generated-video.mp4', 'video/mp4', 'video'
      );
      await insertMessage(db, projectId, chatId, 'assistant',
        `[ VIDEO_GEN ] Generated video for: "${prompt}"`,
        { attachments: [attachment], generated: 'video', model: job.model || 'openrouter-video' });
      return Response.json({ success: true, done: true, attachment });
    }

    if (!prompt || !String(prompt).trim()) {
      return Response.json({ success: false, error: 'prompt is required' }, { status: 400 });
    }

    // The prompt itself becomes a persisted user message, like normal chat.
    const userMsgId = await insertMessage(db, projectId, chatId, 'user',
      `[ ${String(kind).toUpperCase()}_GEN ] ${prompt}`, { skill: kind });

    if (kind === 'image') {
      const { bytes, mime, ext } = await generateImage(prompt);
      const attachment = await storeAttachment(db, projectId, chatId, bytes, `generated-image.${ext}`, mime, 'image');
      await insertMessage(db, projectId, chatId, 'assistant',
        `[ IMAGE_GEN ] Generated image for: "${prompt}"`,
        { attachments: [attachment], generated: 'image', model: IMAGE_MODEL }, userMsgId);
      return Response.json({ success: true, done: true, attachment });
    }

    if (kind === 'audio') {
      const bytes = await generateSpeech(prompt);
      const attachment = await storeAttachment(db, projectId, chatId, bytes, 'generated-audio.wav', 'audio/wav', 'audio');
      await insertMessage(db, projectId, chatId, 'assistant',
        `[ AUDIO_GEN ] Generated speech for: "${prompt.slice(0, 200)}"`,
        { attachments: [attachment], generated: 'audio', model: TTS_MODEL }, userMsgId);
      return Response.json({ success: true, done: true, attachment });
    }

    if (kind === 'video') {
      const model = await pickVideoModel();
      const res = await fetch(`${OR_BASE}/videos`, {
        method: 'POST',
        headers: orHeaders(),
        body: JSON.stringify({ model, prompt }),
      });
      if (!res.ok) throw new Error(`Video generation failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
      const job = await res.json();
      const newJobId = job.id || job.data?.id;
      if (!newJobId) throw new Error('Video generation returned no job id.');
      return Response.json({ success: true, pending: true, jobId: newJobId, model });
    }

    return Response.json({ success: false, error: `Unknown kind: ${kind}` }, { status: 400 });
  } catch (error) {
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

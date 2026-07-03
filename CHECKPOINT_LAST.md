# Checkpoint (2026-07-03, agent: claude-fable-main)

## Completed
- Media/file uploads: private `attachments` Supabase Storage bucket (operator-only
  RLS, 50MB cap, recorded in master_migration.sql). "+" button opens a file picker,
  uploads to `projectId/chatId/`, queues chips with remove buttons, attachments ride
  in `memories.metadata.attachments` and render inline (image/audio/video/file chip)
  via signed URLs (`src/components/AttachmentView.tsx`, `src/lib/attachments.ts`).
- Multimodal input: `ChatMessage.content` supports OpenAI-style parts
  (`src/lib/providers.ts`); Anthropic gets converted blocks. Server signs image URLs
  for vision, inlines text-like files (30k char cap), placeholders for history rows.
- Generation skills: `/api/generate` via OpenRouter unified APIs. IMAGE_GEN
  (gemini-3.1-flash-image-preview, b64 -> storage), AUDIO_GEN
  (gemini-3.1-flash-tts-preview, PCM -> WAV wrap server-side), VIDEO_GEN (async job
  + client polling, model picked from /videos/models preferring seedance/wan).
  WEB_SEARCH toggle -> OpenRouter `plugins: [{id:'web'}]`.
- Skills bar buttons are now mode toggles; compose bar adapts (GEN button,
  mode-specific placeholder). Shared server auth extracted to `src/lib/serverSupabase.ts`.
- Roadmap saved: MemPalace memory `chatsite-roadmap` + TASK_QUEUE.md roadmap section
  (connectors: Google Drive, Canva, Notion, GitHub, Gmail via OAuth + MCP-client layer).

## Verified
- Build green, eslint clean, 20/20 vitest.
- Live Playwright on :3060 with operator session: image upload -> vision model
  correctly described content; IMAGE_GEN produced + rendered a stored image;
  AUDIO_GEN produced playable WAV; WEB_SEARCH returned live news with source;
  attachments persist and re-render after reload.
- Skipped live: VIDEO_GEN end-to-end (expensive; code path implemented, untested
  against a real job) and STT/voice input (not built yet — on roadmap).

## Also completed this session (second round)
- Voice input: mic button -> MediaRecorder -> /api/transcribe (OpenRouter STT,
  Voxtral primary / Whisper fallback). Verified live: TTS->STT round trip
  transcribed correctly; route rejects unauthenticated calls (401).
- Connectors v1 (MCP-client layer, see PLAN.md): `connectors` table (operator
  RLS), src/lib/mcp.ts (Streamable-HTTP JSON-RPC client), /api/tools (GET
  catalog / POST approval-gated call, result persisted as system message),
  tool catalog injected into the chat system prompt (5-min cache), USE_TOOL
  approval card, connectors manager in Settings. Verified live end-to-end with
  the public DeepWiki MCP server: model emitted a valid USE_TOOL tag, RUN TOOL
  returned the React wiki structure, follow-up turn read the result from
  history. 22/22 vitest.

## Next action
- Connectors v2: OAuth authorization-code flow (Google Drive, Canva, Gmail need
  it) and optional auto-execution loops. Also VIDEO_GEN still untested live.

## Human decisions needed
- See TASK_QUEUE.md "Open (all blocked on user)" (incl. password rotation).

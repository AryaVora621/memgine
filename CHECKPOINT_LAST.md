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

## Next action
- Roadmap next: voice input (STT via /api/v1/audio/transcriptions), connectors
  via an MCP-client layer.

## Human decisions needed
- See TASK_QUEUE.md "Open (all blocked on user)" (incl. password rotation).

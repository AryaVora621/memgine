# Checkpoint (2026-07-04, agent: claude-sonnet-main)

## This session
- Diagnosed "AUTO-ACCEPT toggle not visible": the code was already correct
  (src/app/page.tsx header, committed in dd24db9) — the real issue was stray
  dev servers from OTHER projects (dropshipper on :3000, adhdsat on :3001)
  shadowing this project's actual port. This project's dev server runs on
  :3060 (see package.json). Killed 6 stray processes (adhdsat, dropshipper,
  roboPet) at the operator's request; kept headroom (:8787), serena MCP, and
  claude-peers/plugin infra running since they back this Claude Code session.
- Fixed a real bug: `/api/mcp/key` 401'd every time because
  `regenerateMcpKey` in src/components/SettingsModal.tsx posted with no
  Authorization header, unlike every other authed fetch in that file. Fixed
  to fetch the Supabase session token and send it as Bearer, matching the
  existing pattern (lines ~120/142 in the same file). Verified live via
  Playwright against localhost:3060 with an existing operator session — key
  generated successfully, no 401. Not yet committed.
- NOT yet verified on production (memgine.vercel.app) — only tested locally.
  Do this before considering the fix fully done.

## Next action
- Re-verify the /api/mcp/key fix on memgine.vercel.app after it's committed
  and deployed (Vercel auto-deploys from main per earlier checkpoint).
- Local-machine agent capabilities: operator wants the agent to (a) know
  explicitly whether the current session is local (localhost:3060) vs the
  deployed production site, and (b) local-only, get terminal access — create
  directories, browse the filesystem, scan serial ports, run shell commands.
  This is a new capability, not a bug fix — needs a design/safety pass before
  writing code:
  - Precedent in this codebase: RUN_CODE already runs arbitrary python/node/
    bash, but in a remote Vercel Sandbox (Firecracker microVM), NOT the
    operator's real machine — that's the key difference in blast radius.
  - `isLocal` already exists client-side (src/app/page.tsx ~line 488, checks
    window.location.hostname). No server-side equivalent exists yet — any new
    local-exec API route MUST gate itself server-side too (e.g. refuse unless
    an explicit local-only env var is set, never present in Vercel env), so
    the same code deployed to production can't be tricked into executing
    shell commands on Vercel's infra.
  - Dead code found in passing: src/app/page.tsx calls fetch('/api/persona/sync')
    and fetch('/api/agent/sync') (guarded by `activeProject.path && isLocal`)
    but neither route exists under src/app/api — these silently 404 today
    (empty catch block swallows it). Worth fixing or removing when touching
    this area; unrelated to the new terminal-access feature itself.
  - Open questions for the operator before implementing (see next message):
    approval-gating (should local terminal commands be auto-acceptable like
    RUN_CODE, or always require a manual click given real-machine blast
    radius?), directory scope (confined to project paths, or full filesystem
    browse as literally requested?), and whether "scan serial" means listing
    serial/USB devices for a hardware project (roboPet was seen running
    locally earlier this session, which may be the actual motivation).

## Human decisions needed
- See "Open questions" above — answered via AskUserQuestion in the live
  session, not necessarily reflected here if this checkpoint is read cold.
- See TASK_QUEUE.md "Open (all blocked on user)" for older items (password
  rotation etc.), still unresolved.

---

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

## Third round (2026-07-03 later)
- UI fixes: compose-row grid was 3-col and the mic button broke it (fixed to
  4-col); new .action-btn class replaces borderless tab-btn in connectors UI.
- OAuth connectors shipped (src/lib/mcpOauth.ts, /api/oauth, /oauth/callback):
  discovery + dynamic client registration + PKCE + refresh. Verified live:
  Canva and Notion hosted MCP servers both registered Memgine as a client and
  returned real authorization URLs; Canva's consent screen loads with full MCP
  scopes. Canva + Notion connectors are pre-registered in Settings — the
  operator just clicks CONNECT and logs in.
- Gmail/Google Drive: Google has no public hosted MCP endpoint; needs a native
  Google OAuth integration or a third-party Gmail MCP server (v2 decision).

## Next action
- Operator: click CONNECT on canva/notion in Settings to finish the grant.
- v2 candidates: auto-execution tool loops, native Google integration,
  VIDEO_GEN live test.

## Human decisions needed
- See TASK_QUEUE.md "Open (all blocked on user)" (incl. password rotation).

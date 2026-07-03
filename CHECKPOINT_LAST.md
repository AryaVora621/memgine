# Checkpoint - 2026-07-03 late (agent: claude-fable-main)

## Completed (senior-review fix round; all 5 findings addressed)
1. Context limits: recent-30 verbatim history + rolling summary. New chats
   columns summary/summary_upto; /api/chat folds older messages into a dense
   summary (via the selected model, best-effort) once >44 unsummarized, injects
   it as CONVERSATION_SUMMARY. Raw messages stay in `memories` verbatim
   (mempalace "drawers" pattern from github.com/mempalace/mempalace).
2. Server-side source of truth: /api/chat now fetches history, personas, and
   memories itself via a JWT-scoped Supabase client (RLS applies); persists the
   user message BEFORE the model call and the assistant message after the
   stream. Client-sent history/memories/personas only used in Supabase-less
   local setups. Client no longer writes chat messages to the DB at all.
3. Card replay: unique (project_id,name) on project_memories and
   project_agents; executeAddFact/handleAddFact are upserts on that key, so
   re-approving a card replaces instead of duplicating. System prompt documents
   that reusing a name intentionally replaces.
4. Hybrid memory recall (mempalace-style): pgvector embedding(384) column +
   hnsw index; `embed` edge function using built-in gte-small (deployed, no
   API keys, source in supabase/functions/embed/); match_memories() SQL scores
   semantic + keyword boost (cap 0.24) + recency boost (0.1, 60d decay).
   Injection = full INDEX always + top-8 recalled bodies (all bodies while
   palace < 12). 10 seeded memories backfilled; self-query test ranks
   correctly. Client embeds new facts fire-and-forget after save.
5. God component / zero tests: tag parsing extracted to src/lib/tags.ts (pure,
   incl. new extractTags + stripIncompleteTagTail), AskUserCard to
   src/components/AskUserCard.tsx; vitest installed (`npm test`), 20 parser
   tests green. tsconfig excludes supabase/functions (Deno).
6. Streaming: streamProvider() in providers.ts (Anthropic SSE + OpenAI-dialect
   SSE for OpenRouter/OpenAI/Google; local CLI single chunk); /api/chat
   returns SSE (delta/error/done events); client renders into a live
   placeholder with STREAMING label, ▋ cursor, and incomplete-tag suppression.
   Migrations recorded in supabase/migrations/master_migration.sql; live
   AGENTS.md persona row updated to describe recall + summary behavior.

## Verified END-TO-END (Playwright on :3060, operator session, 2026-07-03)
- Streamed chat: STREAMING label + live text, hybrid recall correctly surfaced
  model-routing, operator-profile, and adhd-communication memories.
- Persistence: both sides of the exchange in DB (server-side writes), rendered
  after reload.
- ASK_USER options card: 4 OPTION choices + Other + notes; selected
  "Memory Palace (Recommended)" with a note, submitted; answer+notes became
  the user message; card locked [ SENT: ... ].
- ADD_FACT approval: two linked memories (core-engine, routing-logic) stored
  with metadata; [[core-engine]] cross-link visible as red edge in MEMORY_MAP
  alongside room hubs and type-colored nodes.
- Rolling summary fired for real: 62-message chat folded to a coherent summary
  with summary_upto watermark set.
- FIXED during testing: embed edge function lacked CORS preflight handling, so
  browser-side embedding of approved facts failed silently (fact still stored).
  Redeployed v2 with CORS headers; verified routing-logic embedded from the
  browser; backfilled the one missed row. Graph legend also updated from chat
  roles to memory types.
- npm run build clean, 20/20 vitest green.

## In progress
- Nothing mid-flight. All work uncommitted on feature/supabase-multi-chat.

## Next action
- Commit the branch (large batch: streaming, recall, server-truth, tests).
- SECURITY: operator shared their password in chat on 2026-07-03; rotation was
  already queued in TASK_QUEUE.md and is now more urgent.

## Human decisions needed
- See TASK_QUEUE.md Open section (Supabase dashboard toggles, Anthropic key,
  password rotation).

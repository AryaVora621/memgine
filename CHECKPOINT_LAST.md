# Checkpoint - 2026-07-02 evening (agent: claude-fable-main)

## Completed
- Google models rerouted through OpenRouter BYOK (native Gemini key is free-tier);
  all 3 verified live on prod. Stale auth user aryavora21@gmail.com deleted.
- Mobile-responsive layout shipped (drawer sidebar with hamburger/backdrop,
  single-column grid, palace/persona horizontal room strip, scrollable tabs,
  capped login card). All mobile Playwright checks pass at 390x844, including a
  live chat send.
- Persona system overhauled (commit ec9289e, on main): new IDENTITY/SOUL/AGENTS
  defaults documenting the Memgine environment and tool contract; ASK_USER tag
  added end to end (system prompt + amber question card in chat); predefined
  agents got a shared env briefing plus per-agent ask-vs-act rules; TESTING
  project seeded with the new files in Supabase (it previously had NO persona
  rows at all).

## In progress
- Vercel auto-deploy of ec9289e rolling out.

## Next action
- Spot-check mobile layout + ASK_USER card on memgine.vercel.app after deploy.

## Human decisions needed
- See TASK_QUEUE.md Open section (Supabase dashboard toggles, Anthropic key,
  password rotation).

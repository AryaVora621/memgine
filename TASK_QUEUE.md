# Task Queue

## Open (all blocked on user)
- USER: disable public email sign-ups in Supabase dashboard (Auth > Sign In/Up).
- USER: enable leaked-password protection (Supabase dashboard, Auth settings).
- USER: decide whether to add ANTHROPIC_API_KEY (Claude Sonnet 5 native entry currently
  errors cleanly) or remove that model entry.
- USER: decide whether to delete stale auth user aryavora21@gmail.com.
- USER: consider rotating the operator password (it was shared in a chat session).

## In-Progress
(none)

## Done (2026-07-02)
- Production live at memgine.vercel.app; auto-deploy from main verified working.
- All env vars pushed to Vercel (Supabase URL/anon key, OpenRouter, Gemini); all providers
  verified live in production.
- /api/chat locked to authenticated callers (was anonymously callable on the public URL).
- Model lineup researched against the full OpenRouter catalog and rebuilt in tiers:
  7 free, 4 budget paid, 3 quality paid; every paid entry verified with the account key.
  DeepSeek V4 Flash recommended as default daily driver.
- Full-app test sweep (18 checks across auth, chat, projects, facts, personas, agents,
  graph, settings) plus three bug fixes found by testing.
- Earlier: RLS restricted to operator email, login gate, lint 39 -> 0, prod build green.

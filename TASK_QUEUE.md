# Task Queue

## Open
- USER: disable public email sign-ups in Supabase dashboard (Auth > Sign In/Up).
- USER: enable leaked-password protection (Supabase dashboard, Auth settings).
- Deploy to Vercel (awaiting user go-ahead; env vars from .env.example must be set in Vercel).
- Optional: surface defaultModel picker in SettingsModal.
- Optional: delete stale auth user aryavora21@gmail.com (cannot access data either way).

## In-Progress
(none)

## Done (2026-07-02)
- Pushed to main: ba1c1b6 (hardening pass), 4a9bb0c (deploy prep).
- Deploy prep: .env.example, real README, master_migration.sql now matches deployed RLS
  (was still disabling RLS), stale default model fallback updated.
- Full end-to-end test sweep (Playwright + SQL): auth cycle, chat send/persist, multi-chat
  isolation, project create/delete + cascade integrity, facts CRUD, persona save/persist,
  agent creation, memory graph, settings modal, custom model input. All passing.
- Bugs fixed during testing: project-creation seeding race, Enter-to-submit on new project,
  password autofill into API key fields.
- Security: RLS on all 6 tables restricted to operator email; anon access verified blocked.
- Auth: single-operator login gate + logout; operator password set per user instruction.
- Code quality: ESLint 39 -> 0, tsc clean, prod build green.

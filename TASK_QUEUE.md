# Task Queue

## Open
- Disable public email sign-ups in Supabase dashboard (Auth > Sign In/Up). RLS already blocks
  non-operator accounts, but closing sign-ups removes noise. Dashboard-only toggle.
- Enable leaked-password protection (Supabase dashboard, Auth settings). WARN-level advisor.
- Optional: delete stale auth user aryavora21@gmail.com (left in place; it cannot access data).
- Optional: surface defaultModel in SettingsModal.
- Deploy: settings.ts writes API keys to a local file (.notebook_config); on Vercel this will not
  persist between invocations. Move keys to env vars before deploying.
- Commit session changes (user chose "not yet" on 2026-07-02).

## In-Progress
(none)

## Done (2026-07-02)
- Auth: login gate (email/password) added to page.tsx, logout button, session-scoped data fetches.
- Auth: aryavora621@gmail.com password set per user instruction; probe account deleted.
- Security: RLS enabled on all 6 tables, policies restricted to operator email via is_operator().
  Verified: anon REST returns [], signed-in app fully functional, chat persists under RLS.
- Code quality: 39 ESLint problems -> 0, tsc clean, prod build passes.
- Fixes: memory graph (was 404), project name in system prompt, OpenRouter empty-content handling,
  persona draft reset, model persistence (localStorage), turbopack root warning, removed
  better-sqlite3 + scratch.tsx.
- Full Playwright smoke test: login (wrong + right password), all tabs, end-to-end chat, Supabase writes.

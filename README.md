# Notebook (Memgine)

A cloud-first AI context engine: projects act as virtual folders containing multiple chat
sessions, backed entirely by Supabase. Includes a memory palace for structured facts, an
OpenClaw-style persona system (IDENTITY / SOUL / AGENTS markdown), multi-agent overlays,
and a force-graph visualization of conversation memory.

## Stack

- Next.js 16 (App Router, Turbopack) + React 19
- Supabase: Postgres, Auth (single-operator login), RLS on every table
- Providers: Anthropic, OpenAI, Google Gemini, OpenRouter, local CLI models

## Setup

1. Copy `.env.example` to `.env.local` and fill in the values.
2. Apply `supabase/migrations/master_migration.sql` to your Supabase project.
3. Create your operator account in Supabase Auth, and update the operator email in the
   `is_operator()` SQL function (RLS policies key on it).
4. `npm install && npm run dev` (serves on port 3060).

## Production notes

- All data access happens client-side against Supabase under RLS; API routes only proxy
  AI providers and local settings.
- On Vercel, `.notebook_config/settings.json` is not persisted: provider API keys must be
  set as environment variables (see `.env.example`).
- Recommended Supabase dashboard settings: disable public sign-ups, enable leaked
  password protection.
- Local CLI models (`agy -p` / `claude -p`) only work when running on localhost.

## Quality gates

```bash
npx tsc --noEmit   # types
npm run lint       # eslint
npm run build      # production build
```

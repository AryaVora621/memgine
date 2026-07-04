# Notebook (Memgine)

A cloud-first AI context engine: projects act as virtual folders containing multiple chat
sessions, backed entirely by Supabase. Includes a memory palace for structured facts, an
OpenClaw-style persona system (IDENTITY / SOUL / AGENTS markdown), multi-agent overlays,
and a force-graph visualization of conversation memory.

## It can edit itself

Memgine can propose real pull requests against its own source. Point it at a `github`
connector, ask it to look at the codebase (or let it notice a bug while working a task),
and it opens a branch + PR the same way it calls any other tool — one click (or
auto-accept) per tool call, never a direct push to main. Everything in this repo's git
history tagged as agent-authored got there this way: the app improving itself, one
approved change at a time.

## Approval-gated agent actions

Every action the model wants to take — editing a persona file, saving a memory, defining
a sub-agent, calling a connected tool, running real code in a sandbox — renders as an
approval card requiring a click, or fires on its own if the global auto-accept toggle is
on. After a tool/sandbox result lands, the model automatically gets a chance to react to
it (no more typing "continue" after every step), bounded by a hard auto-continue cap, a
`<STOP/>` tag the model can emit once it's done, and a manual STOP button for the
operator.

## MCP, both directions

- **As a client**: register any remote MCP server (static key or full OAuth 2.1) and its
  tools show up in chat, approval-gated like everything else.
- **As a server**: `/api/mcp` exposes Memgine's own memory palace to external MCP clients
  (Claude Desktop, other agents) via a single static operator key — add a fact from
  outside, see it in the chat UI, and vice versa.

## Stack

- Next.js 16 (App Router, Turbopack) + React 19
- Supabase: Postgres, Auth (single-operator login), RLS on every table
- Vercel Sandbox for real code execution (`RUN_CODE`), scoped per chat
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

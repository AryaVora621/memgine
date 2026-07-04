-- 1. Create chats table if it doesn't exist (without user_id)
CREATE TABLE IF NOT EXISTS public.chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'New Chat',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Link memories to chats (if not already done)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='memories' AND column_name='chat_id'
  ) THEN
    ALTER TABLE public.memories ADD COLUMN chat_id UUID REFERENCES public.chats(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 3. Drop legacy user_id columns and their attached policies
ALTER TABLE public.projects DROP COLUMN IF EXISTS user_id CASCADE;
ALTER TABLE public.memories DROP COLUMN IF EXISTS user_id CASCADE;
ALTER TABLE public.project_memories DROP COLUMN IF EXISTS user_id CASCADE;
ALTER TABLE public.project_personas DROP COLUMN IF EXISTS user_id CASCADE;
ALTER TABLE public.project_agents DROP COLUMN IF EXISTS user_id CASCADE;

-- 4. Single-operator security model.
-- Public signups may be enabled on the Supabase project, so "any authenticated user"
-- is not a safe boundary. Every table is restricted to the operator account.
-- The function lives in a non-exposed schema so PostgREST cannot serve it via
-- /rest/v1/rpc (Supabase advisor lints 0028/0029).
-- CHANGE THE EMAIL BELOW when deploying under a different account.
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.is_operator()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(auth.jwt()->>'email', '') = 'aryavora621@gmail.com';
$$;

REVOKE ALL ON FUNCTION private.is_operator() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_operator() TO authenticated;

DROP FUNCTION IF EXISTS public.is_operator();

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_agents ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects','chats','memories','project_memories','project_personas','project_agents']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "operator full access" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "operator full access" ON public.%I FOR ALL TO authenticated USING (private.is_operator()) WITH CHECK (private.is_operator())',
      t
    );
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Memory-file format (mirrors Claude Code's memory system).
-- Every MemPalace fact becomes a named, typed memory with a one-line
-- description, equivalent to a memory file's frontmatter:
--   name: kebab-case slug          → project_memories.name
--   description: one-line summary  → project_memories.description
--   metadata.type: user|feedback|project|reference → project_memories.mem_type
-- Applied 2026-07-03 as migration "memory_file_format".
ALTER TABLE public.project_memories
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS mem_type text NOT NULL DEFAULT 'project'
    CHECK (mem_type IN ('user', 'feedback', 'project', 'reference'));

-- ─────────────────────────────────────────────────────────────────────────────
-- Hybrid memory recall (mirrors mempalace tiered retrieval: semantic + keyword
-- + temporal boosts). Applied 2026-07-03 as migration "hybrid_memory_recall".
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
ALTER TABLE public.project_memories
  ADD COLUMN IF NOT EXISTS embedding extensions.vector(384);
CREATE INDEX IF NOT EXISTS project_memories_embedding_idx
  ON public.project_memories USING hnsw (embedding extensions.vector_cosine_ops);
CREATE UNIQUE INDEX IF NOT EXISTS project_memories_project_name_key
  ON public.project_memories (project_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS project_agents_project_name_key
  ON public.project_agents (project_id, name);
ALTER TABLE public.chats
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS summary_upto timestamptz;
CREATE OR REPLACE FUNCTION public.match_memories(
  p_project uuid,
  p_query text,
  p_terms text[] DEFAULT '{}',
  p_k int DEFAULT 8
)
RETURNS TABLE (
  id uuid,
  room_name text,
  name text,
  description text,
  mem_type text,
  fact_content text,
  score double precision
)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT
    m.id, m.room_name, m.name, m.description, m.mem_type, m.fact_content,
    (
      CASE WHEN m.embedding IS NULL THEN 0.0
           ELSE 1.0 - (m.embedding <=> p_query::extensions.vector(384)) END
      + LEAST(0.24, 0.06 * (
          SELECT count(*)::float FROM unnest(p_terms) t
          WHERE m.name ILIKE '%' || t || '%'
             OR m.description ILIKE '%' || t || '%'
             OR m.fact_content ILIKE '%' || t || '%'
        ))
      + 0.1 * exp(-extract(epoch FROM (now() - m.created_at)) / (60.0 * 86400.0))
    ) AS score
  FROM public.project_memories m
  WHERE m.project_id = p_project
  ORDER BY score DESC
  LIMIT p_k;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Chat attachments storage (uploads + generated media). Operator-only, private
-- bucket, 50MB per object. Applied 2026-07-03 as migration "attachments_storage".
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('attachments', 'attachments', false, 52428800)
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "operator attachments" ON storage.objects;
CREATE POLICY "operator attachments" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'attachments' AND private.is_operator())
  WITH CHECK (bucket_id = 'attachments' AND private.is_operator());

-- ─────────────────────────────────────────────────────────────────────────────
-- MCP connectors (operator-registered remote MCP servers). Applied 2026-07-03
-- as migration "connectors".
CREATE TABLE IF NOT EXISTS public.connectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  url text NOT NULL,
  auth_token text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.connectors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "operator connectors" ON public.connectors;
CREATE POLICY "operator connectors" ON public.connectors
  FOR ALL TO authenticated
  USING (private.is_operator())
  WITH CHECK (private.is_operator());

-- ─────────────────────────────────────────────────────────────────────────────
-- OAuth support for MCP connectors. Applied 2026-07-03 as "connectors_oauth".
ALTER TABLE public.connectors ADD COLUMN IF NOT EXISTS oauth jsonb;

-- ─────────────────────────────────────────────────────────────────────────────
-- Global (cross-project) memory scope. A reserved sentinel project row holds
-- memories visible from every project (operator identity, cross-cutting
-- preferences), alongside the existing per-project palace. Applied 2026-07-03
-- as migration "global_memory_scope".
INSERT INTO public.projects (id, name, path, created_at)
VALUES ('00000000-0000-0000-0000-000000000000', 'GLOBAL', '', now())
ON CONFLICT (id) DO NOTHING;

-- match_memories returns project_id too, so callers can label GLOBAL vs
-- project-local memories in the recalled set, not just the index. Applied
-- 2026-07-03 as migration "match_memories_return_project_id".
DROP FUNCTION IF EXISTS public.match_memories(uuid, text, text[], int);

CREATE FUNCTION public.match_memories(
  p_project uuid,
  p_query text,
  p_terms text[] DEFAULT '{}',
  p_k int DEFAULT 8
)
RETURNS TABLE (
  id uuid,
  project_id uuid,
  room_name text,
  name text,
  description text,
  mem_type text,
  fact_content text,
  score double precision
)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT
    m.id, m.project_id, m.room_name, m.name, m.description, m.mem_type, m.fact_content,
    (
      CASE WHEN m.embedding IS NULL THEN 0.0
           ELSE 1.0 - (m.embedding <=> p_query::extensions.vector(384)) END
      + LEAST(0.24, 0.06 * (
          SELECT count(*)::float FROM unnest(p_terms) t
          WHERE m.name ILIKE '%' || t || '%'
             OR m.description ILIKE '%' || t || '%'
             OR m.fact_content ILIKE '%' || t || '%'
        ))
      + 0.1 * exp(-extract(epoch FROM (now() - m.created_at)) / (60.0 * 86400.0))
    ) AS score
  FROM public.project_memories m
  WHERE m.project_id = p_project OR m.project_id = '00000000-0000-0000-0000-000000000000'
  ORDER BY score DESC
  LIMIT p_k;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Operator settings (single-row global config, e.g. the auto-accept toggle)
-- and per-chat sandbox tracking for RUN_CODE. Applied 2026-07-04 as migration
-- "operator_settings_and_sandbox_columns".
CREATE TABLE IF NOT EXISTS public.operator_settings (
  id boolean PRIMARY KEY DEFAULT true CONSTRAINT operator_settings_singleton CHECK (id),
  auto_accept boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.operator_settings (id, auto_accept) VALUES (true, false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.operator_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "operator_settings_operator_all" ON public.operator_settings;
CREATE POLICY "operator_settings_operator_all" ON public.operator_settings
  FOR ALL
  USING (private.is_operator())
  WITH CHECK (private.is_operator());

ALTER TABLE public.chats
  ADD COLUMN IF NOT EXISTS sandbox_id text,
  ADD COLUMN IF NOT EXISTS sandbox_last_used_at timestamptz;

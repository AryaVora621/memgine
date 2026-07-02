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

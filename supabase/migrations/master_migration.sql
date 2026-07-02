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

-- 3. Disable Row Level Security on all tables to allow Global Sync
ALTER TABLE public.projects DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.memories DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_memories DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_personas DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_agents DISABLE ROW LEVEL SECURITY;

-- 4. Drop user_id and attached policies
ALTER TABLE public.projects DROP COLUMN IF EXISTS user_id CASCADE;
ALTER TABLE public.memories DROP COLUMN IF EXISTS user_id CASCADE;
ALTER TABLE public.project_memories DROP COLUMN IF EXISTS user_id CASCADE;
ALTER TABLE public.project_personas DROP COLUMN IF EXISTS user_id CASCADE;
ALTER TABLE public.project_agents DROP COLUMN IF EXISTS user_id CASCADE;

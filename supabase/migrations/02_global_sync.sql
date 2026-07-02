-- Disable Row Level Security for global sync
ALTER TABLE public.projects DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.memories DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_memories DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_personas DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_agents DISABLE ROW LEVEL SECURITY;

-- Drop user_id columns to remove auth dependency
ALTER TABLE public.projects DROP COLUMN IF EXISTS user_id;
ALTER TABLE public.chats DROP COLUMN IF EXISTS user_id;
ALTER TABLE public.memories DROP COLUMN IF EXISTS user_id;
ALTER TABLE public.project_memories DROP COLUMN IF EXISTS user_id;
ALTER TABLE public.project_personas DROP COLUMN IF EXISTS user_id;
ALTER TABLE public.project_agents DROP COLUMN IF EXISTS user_id;

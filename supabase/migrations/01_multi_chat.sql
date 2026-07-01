-- Create the chats table
CREATE TABLE IF NOT EXISTS public.chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'New Chat',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on chats
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own chats"
ON public.chats FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Update the memories table to include chat_id
-- We add it as nullable first to avoid breaking existing data
ALTER TABLE public.memories ADD COLUMN chat_id UUID REFERENCES public.chats(id) ON DELETE CASCADE;

-- (Optional) If you want to migrate existing memories into a default chat per project:
-- You would need to insert a default chat for each project first, and then update the memories.
-- For example:
-- INSERT INTO public.chats (id, project_id, user_id, name)
-- SELECT gen_random_uuid(), id, user_id, 'Legacy Chat' FROM public.projects;
--
-- UPDATE public.memories m
-- SET chat_id = c.id
-- FROM public.chats c
-- WHERE m.project_id = c.project_id AND m.chat_id IS NULL;

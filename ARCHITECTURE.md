# Architecture Transition Plan: Multi-Chat & Supabase Migration

## 1. Goal
Transition the application from a local SQLite-first architecture to a cloud-first architecture fully backed by Supabase. Concurrently, restructure the conversational hierarchy to allow Projects to act as "Virtual Folders" that can contain multiple distinct Chat sessions.

## 2. Core Architectural Changes

### A. Deprecate Local SQLite (`memoryStore.ts`)
- **Current State:** The app uses `better-sqlite3` to store memories locally in `.notebook_memories/` and attempts to sync them bi-directionally with Supabase in `page.tsx`.
- **New State:** Remove `better-sqlite3` entirely. All reads and writes for chats, projects, memories, personas, and agents will go directly to Supabase via `@supabase/supabase-js`.
- **Action Items:**
  1. Delete/Refactor `src/lib/memoryStore.ts` to operate entirely as a Supabase client wrapper or remove it completely and use `supabaseClient.ts` directly.
  2. Remove the complex bi-directional sync logic (`handleSync`) in `src/app/page.tsx` since we will treat Supabase as the single source of truth.
  3. Remove local fallback project storage (`src/lib/settings.ts` projects array) and rely on Supabase for the project list. 

### B. Hierarchical Restructuring (Virtual Folders -> Chats)
- **Current State:** Hierarchy is `Project -> Messages`. The `projectId` is the only grouping mechanism for memories.
- **New State:** Hierarchy is `Project (Virtual Folder) -> Chat (Session) -> Messages`.
- **Action Items:**
  1. **Database Schema:** 
     - Create a new `chats` table in Supabase (`id`, `project_id`, `name`, `created_at`, `user_id`).
     - Update the `memories` table to include a `chat_id` foreign key.
  2. **API Updates:**
     - Update `/api/chat` to accept `chatId` and save messages linked to that chat.
     - Update `/api/memory` to fetch messages by `chatId` instead of `projectId`.
  3. **UI Updates (`page.tsx`):**
     - Add a mechanism to create and select a "Chat" within the active Project.
     - Maintain an `activeChatId` state.
     - Update the chat view to render messages for the selected `activeChatId`.
     - Remove physical directory path dependencies (already completed).

## 3. Implementation Steps

1. **Step 1: Cleanup Local State & Sync Logic**
   - Clean up `page.tsx` to remove the local SQLite sync triggers and complex reconciliation.
   - Refactor the startup flow to strictly fetch Projects from Supabase instead of local APIs.

2. **Step 2: Database Schema Migration**
   - Provide the SQL migration scripts to execute in the Supabase dashboard to create the `chats` table and update the `memories` table.

3. **Step 3: Update Backend API Routes**
   - Rewrite `src/app/api/chat/route.ts` and `src/app/api/memory/route.ts` to directly interact with Supabase using the new `chatId` structure.
   - Remove `src/lib/memoryStore.ts` SQLite bindings.

4. **Step 4: Frontend UI Updates**
   - Add a Chat selection sub-menu under the Project view.
   - Wire the chat interface to load/send messages using the selected Chat ID.

## 4. Considerations
- **Offline Support:** By moving fully to Supabase, the application will require an internet connection and configured Supabase credentials to function.
- **Environment Variables:** `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (and optionally a service role key for API routes) will become strict requirements rather than optional sync targets.

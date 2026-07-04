# memgine-memory

Durable, git-backed storage for Memgine, separate from the Supabase Memory
Palace (which holds structured facts). This folder is for things that are
naturally files: sandbox-generated artifacts the agent decides are worth
keeping, exported memory snapshots, longer documents, or anything else the
agent wants to persist outside the database.

The agent writes here through its own `github` connector tools (create/update
file, commit, PR) — the same approval-gated USE_TOOL flow as any other
connector call. There's no separate mechanism; this README exists so both the
agent and the operator know what this folder is for and that files placed
here are meant to stick around.

Suggested layout (create subfolders as needed, don't over-organize upfront):

- `exports/` — memory palace or chat exports the agent or operator wanted a durable copy of
- `artifacts/` — files produced by a RUN_CODE sandbox run worth keeping
- `notes/` — longer-form docs that don't fit as a single Memory Palace fact

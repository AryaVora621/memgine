# Checkpoint - 2026-07-02 (agent: claude-fable-main)

## Completed
- Full production polish + security pass, then a complete end-to-end test sweep:
  auth cycle, chat send/persist, multi-chat isolation, project create/delete,
  MemPalace facts CRUD, persona save/persist, agent creation, memory graph,
  settings modal, custom model input. All passing.
- Bugs found by testing and fixed:
  - handleCreateProject raced its own seeding (Main Chat/personas inserted after
    activation, so fetch effects missed them). Reordered: seed first, then activate.
  - New-project input did not submit on Enter. Added.
  - Browser credential autofill landed the login password in the Anthropic API key
    field (password-type input). Added autoComplete="new-password".
- Earlier same day: RLS locked to operator email, login gate, memory graph fix,
  OpenRouter empty-content handling, model persistence, lint 39 -> 0.
- DB integrity verified: cascade deletes leave zero orphans. Test data cleaned up.

## Next action
- Commit and push to main (user instructed 2026-07-02: "once we are ready push to main").

## Human decisions needed
- (none pending)

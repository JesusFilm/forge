# Chat Agent Guide

Scope: `apps/chat`.

## Alignment

`apps/chat/CLAUDE.md` is canonical detail for this app.

## Do

- Keep assistant replies coming from the client-side stub
  (`src/lib/chat-stub.ts`) — it is the seam the eventual Mastra wiring
  replaces.
- Keep the chat page a single full-screen surface.
- Follow `apps/web`'s engineering config (eslint extends root, strict
  `src/` tsconfig) and the repo prettier rules (no semicolons).
- Run lint, typecheck, and test before pushing.

## Do not

- Do not wire real agents, auth, or a database without a roadmap ticket —
  this app is stub-only by design (feat-200).
- Do not add API routes, server actions, or streaming.
- Do not add conversation persistence (a database, or storage that survives a
  refresh) without a roadmap ticket. The multi-conversation sidebar (feat-201)
  is intentionally client-only and resets on refresh.
- Do not import internals from other apps; no app may import from
  `apps/chat`.
- Do not assign a `jesusfilm.org` DNS entry to the deployed service.

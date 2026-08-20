---
title: "Local mastra dev storage does not survive a dev-server restart"
date: "2026-08-19"
category: developer-experience
module: apps/chat + apps/mastra
problem_type: developer_experience
component: development_workflow
severity: medium
applies_when:
  - "Running apps/mastra locally via `pnpm --filter @forge/mastra dev` and restarting the dev server mid-session"
  - "Browser-verifying apps/chat history/replay flows against a local mastra dev backend with accumulated thread fixtures"
  - "Planning verification-matrix ordering that includes deliberately stopping/restarting mastra dev to induce a failure state"
  - "Debugging a `thread_not_found` upstream_rejected error against local mastra right after a dev restart"
symptoms:
  - "History list returns empty immediately after `pnpm --filter @forge/mastra dev` is restarted"
  - 'Replaying a previously working thread id returns "[history-proxy] event=upstream_rejected reason=thread_not_found"'
  - "All previously created ai_chat threads under a resource (e.g. user:agent-dogfood) are gone after restart, not just the most recent one"
tags:
  - mastra
  - apps-chat
  - local-dev
  - dev-server-restart
  - thread-storage
  - thread-not-found
  - browser-verification
  - fixture-loss
---

# Local mastra dev storage does not survive a dev-server restart

## Context

During the feat-209 browser matrix (2026-08-19), 21 `ai_chat` threads were
created as fixtures under the dogfood resource (`user:agent-dogfood`) through
real chat sends against a local `pnpm --filter @forge/mastra dev` on port 4111. One matrix row needed a replay "failed" state, so the mastra dev server
was deliberately stopped and restarted
(`pnpm -C /workspace --filter @forge/mastra dev`). After the restart, every
previously created thread was gone: the history list returned empty, and
replaying a previously-working thread id returned:

```
[history-proxy] event=upstream_rejected reason=thread_not_found
```

Chat's UI handled it correctly — the vanished thread id resolved to the
"no longer available" denial screen — but the entire 21-thread fixture set
was lost mid-verification and had to be partially rebuilt.

## Guidance

**Mechanism (confirmed from source, not just observed).** Local
`mastra dev` runtime storage does not survive a restart when it is running on
the `memory` backend. `apps/mastra/src/mastra/index.ts:197-204` selects
`InMemoryStore` when `MASTRA_STORAGE_BACKEND === "memory"`, else
`PostgresStore`; `apps/mastra/src/config/env.ts:302` defaults the backend to
`"postgres"`, but `apps/mastra/CLAUDE.md` ("Environment" table and "Local
run") documents that a local run with no reachable Postgres must set
`MASTRA_STORAGE_BACKEND=memory` or it crashes at boot — and that under
`memory`, ai-chat memory is explicitly "process-lifetime in-memory (wiped on
restart)". The ai-chat lane's own store
(`apps/mastra/src/mastra/ai-chat-memory.ts`,
`resolveAiChatMemoryBackend()` at `apps/mastra/src/config/env.ts:1578-1580`) follows the same backend
unless `AI_CHAT_MEMORY_BACKEND` overrides it. Deployed Mastra persists to
Postgres; a typical local dev loop does not.

1. **Treat local `mastra dev` thread fixtures as ephemeral.** Any restart of
   the local dev server — deliberate, crash-triggered, or FILE-WATCH-triggered
   — wipes every thread created since the last restart, when running on the
   `memory` backend. The watch trigger is the easy one to forget: `mastra dev`
   runs a rollup watcher that respawns the server process after every
   successful rebundle (mastra@1.21.0, the CLI's BUNDLE_END →
   `checkAndRestart` handler), so editing any watched `apps/mastra` source
   file mid-session wipes the fixtures with no deliberate restart.
2. **Sequence restarts last.** Order browser-verification work so any
   deliberate backend stop/restart — including inducing transport-failure
   states — comes AFTER every matrix row that depends on accumulated thread
   fixtures, and freeze `apps/mastra` source edits for the duration of any
   fixture-dependent run (rule 1's watcher makes an edit a restart). A
   mid-run restart silently invalidates every fixture built so far.
3. **Silver lining: a wiped thread is a real erased-thread fixture.** A
   `/c/<id>` URL still sitting in browser history, now pointing at a wiped
   thread, is wire-identical to the feat-336 age-out / feat-337 erasure path
   (`404 thread_not_found`) at the REPLAY wire — though not at the sidebar
   (a wipe empties the whole list, while age-out/erasure leaves siblings
   listed), so it substitutes for deep-link denial rows, not sidebar rows.
   Keep one such URL around deliberately instead of discovering it by
   accident.
4. **Fixture cost corollary.** Creating N threads through real chat sends
   costs N real model generations plus the wall-clock time to drive them —
   free-tier models on the default local chain, actual spend once the AI
   Gateway chat model is enabled for the Seeker. Plan matrix ordering so a
   restart never forces paying that cost twice.
5. **If a wipe happens anyway, re-seed instead of re-sending.** Recipe 2 of
   `chat-mastra-gated-stack-local-smoke-recipes.md` writes threads and
   messages through the local memory routes into the same shared store the
   feat-241 history routes read, with zero model calls. Only rows that need
   real assistant output (sources, video attachments) still require real
   sends.

## Why This Matters

Local dogfood/verification sessions against `apps/mastra dev` routinely need
several pre-existing threads (history list pagination, replay, delete/rename,
denial screens). Losing the whole fixture set to an ill-timed restart burns
real model-call budget and verification time rebuilding state that a
different ordering would have preserved for free.

## When to Apply

- Any `apps/chat` browser verification that seeds threads against a local
  `mastra dev` running on the `memory` backend (see
  `docs/solutions/developer-experience/chat-mastra-gated-stack-local-smoke-recipes.md`
  for the zero-external-deps seeding recipe, whose "Lifetime" note already
  flags this).
- Any matrix or checklist that includes a step to stop/restart the local
  mastra dev process for ANY reason.
- Not applicable to a deployed Mastra environment or a local run pointed at a
  real Postgres `DATABASE_URL` — both persist across restarts. One deployed
  exception: `AI_CHAT_MEMORY_BACKEND=memory` is permitted in production as the
  seeker-persistence kill-switch, and it puts ai-chat memory on an
  `InMemoryStore` (`apps/mastra/src/mastra/ai-chat-memory.ts`), so while it is
  set a deployed restart or redeploy wipes threads exactly as described here.

## Examples

Observed sequence: 21 threads seeded via real sends → `mastra dev` stopped →
`mastra dev` restarted → history list empty → replay of a previously-valid
thread id returns `[history-proxy] event=upstream_rejected
reason=thread_not_found` → chat UI renders the denial screen correctly.

Applied sequencing rule for a verification matrix with rows A (needs 5
fixture threads), B (needs 2 more fixture threads), C (needs a restart to
induce a transport failure): run A, then B, then C last — never interleave C
before A/B are done consuming the fixture set.

## Related

- `docs/solutions/developer-experience/chat-mastra-gated-stack-local-smoke-recipes.md`
  — Recipe 2 is the zero-model-call reseed path rule 5 names (this note's own
  fixture set was built through real chat sends, not that recipe); its
  "Lifetime" note independently records the `memory` backend's
  process-lifetime behavior, and this note adds the restart-ordering rule.
- `apps/mastra/CLAUDE.md` — "Environment" (`MASTRA_STORAGE_BACKEND`) and
  "Local run" (the wiped-on-restart statement, and the shared-thread-leak
  warning under Postgres).
- `apps/mastra/src/mastra/index.ts:197-204` — runtime storage backend
  selection.
- `apps/mastra/src/config/env.ts:302` — the `MASTRA_STORAGE_BACKEND` default
  (`"postgres"`).
- `apps/mastra/src/config/env.ts:1578-1580` — `resolveAiChatMemoryBackend()`,
  the `AI_CHAT_MEMORY_BACKEND` override lever.
- `apps/mastra/src/mastra/ai-chat-memory.ts` — the ai-chat lane's own
  backend-aware storage.

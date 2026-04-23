---
title: "fix: Manager Shared-Agent Hardening"
type: fix
status: active
date: 2026-04-22
roadmap:
  - /docs/roadmap/media-generation/feat-100-manager-shared-agent-control-plane-hardening.md
related:
  - /docs/roadmap/media-generation/feat-099-manager-mastra-control-plane.md
  - /todos/001-pending-p1-durable-agent-sessions-and-approvals.md
  - /todos/002-pending-p1-shared-agent-session-ownership.md
  - /todos/003-pending-p1-require-interactive-approval-for-writeback.md
  - /todos/004-pending-p1-restore-live-translation-writeback.md
  - /todos/005-pending-p2-prevent-shared-agent-approval-replay.md
  - /todos/006-pending-p2-sanitize-hydrated-transcript-context.md
  - /todos/007-pending-p2-make-shared-agent-tool-surface-truthful.md
branch: fix/manager-shared-agent-hardening
---

# fix: Manager Shared-Agent Hardening

## Overview

Review and live validation found that the shared-agent control plane is promising but not yet hardened enough to act as a reliable Manager-owned shared workspace. The next slice needs to secure approvals, make sessions durable and owner-scoped, restore live translation usefulness, and trim or finish the parts of the exposed tool surface that are still scaffolding.

## Validation That Triggered This Plan

1. Focused tests passed:
   - `pnpm --filter @forge/agents test`
   - `pnpm --filter @forge/agents typecheck`
   - `pnpm --filter @forge/manager test`
   - `pnpm --filter @forge/manager typecheck`
   - `git diff --check`
2. `pnpm --filter @forge/manager lint` failed on formatting drift plus unused/dead runtime wiring.
3. Authenticated browser smoke confirmed the agents dashboard loads and library search works.
4. Authenticated API smoke confirmed:
   - library-video search works
   - translation hydration works
   - SEO run returns a structured result
   - translation live run is not yet producing actionable translated metadata/draft patch behavior

## Implementation Units

### Unit 1: Session durability and ownership

- move sessions/runs/approvals out of process-local memory
- store creating operator identity with each session and approval
- enforce owner checks across fetch, message, and approval routes

### Unit 2: Approval hardening

- require interactive Manager-session approval for writeback
- reject replay on resolved approval ids
- keep audit fields explicit about who approved what and when

### Unit 3: Translation live-path repair

- fix the translation workflow so hydrated metadata can become translated metadata directly
- ensure successful translation can produce `draftPatch` and `pendingApproval`
- add regression coverage around the current "missing translation tool results" failure mode

### Unit 4: Prompt and tool-surface truthfulness

- sanitize transcript-derived hydrated context before it reaches draft fields/prompts
- either execute real tools or remove synthetic/no-op tool surfaces
- either wire or remove unreachable follow-up approval and supervisor-only routing claims
- keep scene-signal/tool claims aligned with what Manager can actually provide

### Unit 5: Validation and proof

- fix lint drift
- rerun focused tests
- rerun authenticated browser smoke on `/dashboard/agents`
- rerun authenticated API smoke for search, hydrate, translation, SEO, and approval behavior

## Acceptance Criteria

- [x] Session and approval state survives restart/multi-process routing.
- [x] Session and approval routes enforce operator ownership.
- [x] API-key callers cannot approve writeback unless an explicitly-scoped service path is introduced.
- [x] Resolved approvals cannot be replayed.
- [x] Live translation from a hydrated library video yields translated operator output and, when appropriate, a `draftPatch`.
- [x] Hydrated transcript context is sanitized before model use.
- [x] The public/shared tool and approval surface matches reality.
- [x] `pnpm --filter @forge/manager lint` passes again.

## Risks

- Durable-session work may force a small contract migration for existing in-memory assumptions.
- Tightening approval auth may affect any external automation relying on `MANAGER_API_KEY`.
- Translation fixes may require choosing between a prompt-only repair and a more explicit translation primitive.

## Notes

- This is follow-up hardening, not a rollback of the Mastra control-plane direction.
- The most important rule for this slice is honesty: approvals should really be approvals, sessions should really be resumable, and agent capabilities should only be exposed when they are real.

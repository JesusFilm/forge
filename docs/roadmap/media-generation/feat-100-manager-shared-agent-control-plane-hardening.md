---
id: "feat-100"
title: "Manager Shared-Agent Control Plane Hardening"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-04-23"
duration: 7
depends_on:
  - "feat-099"
blocks: []
tags:
  - "manager"
  - "ai-pipeline"
  - "agents"
  - "mastra"
  - "security"
---

## Problem

The new Manager Mastra control plane is live, but review and live validation exposed several hardening gaps: sessions and approvals are not durable, ownership is not enforced, approval auth is too permissive, translation is not reliably producing actionable metadata patches, and parts of the exposed tool/approval surface are broader than the real implementation.

## Entry Points — Read These First

1. `apps/manager/src/features/agents/shared-agent-control-plane.ts` — session workflows, tool registration, approvals, and runtime assembly
2. `apps/manager/src/features/agents/shared-agent-session-store.ts` — current in-memory session and approval persistence
3. `apps/manager/src/features/agents/shared-agent-contract.ts` — session and approval contracts that need ownership/hardening updates
4. `apps/manager/src/features/agents/shared-agent-video-library.ts` — hydrated library-video context and transcript handling
5. `apps/manager/src/app/api/agents/sessions/route.ts` — session creation boundary
6. `apps/manager/src/app/api/agents/sessions/[id]/route.ts` — session fetch boundary
7. `apps/manager/src/app/api/agents/sessions/[id]/messages/route.ts` — live session run boundary
8. `apps/manager/src/app/api/agents/approvals/[id]/route.ts` — approval action boundary
9. `apps/manager/src/lib/auth.ts` — Manager session/API-key approval policy
10. `todos/001-pending-p1-durable-agent-sessions-and-approvals.md` through `todos/007-pending-p2-make-shared-agent-tool-surface-truthful.md` — review findings to close

## Grep These

- `authenticateManagerOverrideRequest|api_key|approvedByUserId` in `apps/manager/src/`
- `sharedAgentSessionStore|InMemoryStore|Memory` in `apps/manager/src/features/agents/`
- `pendingApproval|apply_video_metadata_patch|enqueue_followup` in `apps/manager/src/features/agents/`
- `translation|target_language|draftPatch` in `apps/manager/src/features/agents/` and `packages/agents/src/`
- `stripPromptInjection|transcriptExcerpt|source_copy|video_context|offer_or_content` in `apps/manager/src/features/agents/`

## What To Build

1. Persist sessions, latest runs, and approvals in a Manager-owned durable store that survives restarts and multi-process routing.
2. Add explicit owner/operator fields to stored session and approval records, and enforce ownership on fetch, message, and approval routes.
3. Restrict write approvals to interactive Manager-session actors unless and until a separately-scoped service approval path exists.
4. Make approvals one-time actions by rejecting replay after resolution.
5. Fix the live translation workflow so hydrated metadata translation produces grounded translated content and, when warranted, a `draftPatch` + approval.
6. Sanitize transcript-derived hydrated context before it can enter draft fields or final prompts.
7. Make the exposed tool/routing surface honest by either wiring or removing stubbed/unreachable capabilities such as synthetic tool events, no-op save-draft behavior, unreachable follow-up approvals, and hidden supervisor-only runtime state.

## Constraints

- Keep Manager as the only runtime host for this slice.
- Do not widen write authority while fixing approvals; hardening should narrow access, not broaden it.
- Preserve the current specialist agent catalog unless and until the supervisor path is intentionally productized.
- Keep `packages/agents` focused on truly shared contracts and validation utilities.
- Any session/approval durability design must stay auditable and operator-scoped.

## Verification

- `pnpm --filter @forge/agents test`
- `pnpm --filter @forge/agents typecheck`
- `pnpm --filter @forge/manager test`
- `pnpm --filter @forge/manager typecheck`
- `pnpm --filter @forge/manager lint`
- `git diff --check`
- Authenticated browser/API smoke:
  - login to Manager
  - open `/dashboard/agents`
  - search and hydrate a library video
  - run translation and SEO from real session APIs
  - confirm translation returns actionable translated metadata instead of a missing-tool explanation
  - confirm write approvals require an interactive Manager session and cannot be replayed

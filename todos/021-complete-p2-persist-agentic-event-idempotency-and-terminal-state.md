---
status: complete
priority: p2
issue_id: "021"
tags: [code-review, reliability, manager, callbacks]
dependencies: []
---

# Persist Agentic Event Idempotency And Terminal State

## Problem Statement

Manager callback ingestion deduplicates Agentic subtitle events using in-memory
sets and per-run sequence maps. That state disappears on process restart and is
not shared across instances, so duplicate or stale callbacks can be applied
again. The route also does not check the persisted job terminal state before
applying later step events.

## Findings

- `apps/manager/src/lib/agentic-subtitle-enrichment.ts:157` stores accepted
  event ids in a module-level `Set`.
- `apps/manager/src/lib/agentic-subtitle-enrichment.ts:158` stores the last
  sequence per run in a module-level `Map`.
- `apps/manager/src/lib/agentic-subtitle-enrichment.ts:280` ignores stale
  sequence numbers only while the process-local map is populated.
- `apps/manager/src/lib/agentic-subtitle-enrichment.ts:285` applies step events
  without checking whether the job is already terminal in persisted state.
- `apps/manager/src/lib/agentic-subtitle-enrichment.ts:233` marks
  `workflow_failed` jobs failed but does not persist the workflow-level error
  message.

## Proposed Solutions

### Option 1: Persist Callback Event State In CMS Or A Durable Store

**Approach:** Store event ids, last accepted sequence, terminal state, and
sanitized workflow failure errors durably with the Manager job or an internal
event ledger.

**Pros:**
- Works across restarts and multiple Manager instances.
- Gives operators durable evidence for callbacks.

**Cons:**
- Requires schema/storage design.

**Effort:** Medium

**Risk:** Medium

---

### Option 2: Make Event Application Strictly Idempotent Without A Ledger

**Approach:** Re-read the job before every event, reject stale non-terminal
updates after terminal states, and make repeated step updates harmless.

**Pros:**
- Smaller implementation.
- Avoids schema changes.

**Cons:**
- Does not provide full duplicate-event audit history.

**Effort:** Small to Medium

**Risk:** Medium

## Recommended Action

Use Option 2 for V1 if a durable event ledger is too large, but at minimum read
persisted job state before applying callbacks and preserve workflow-level error
messages.

## Technical Details

Affected files:

- `apps/manager/src/lib/agentic-subtitle-enrichment.ts`
- `apps/manager/src/app/api/agentic/subtitle-enrichment-runs/[runId]/events/route.ts`
- `apps/manager/src/app/api/agentic/subtitle-enrichment-runs/[runId]/events/route.test.ts`

## Resources

- PR: https://github.com/JesusFilm/forge/pull/886

## Acceptance Criteria

- [x] Duplicate events remain harmless after process restart.
- [x] Stale non-terminal events cannot mutate a completed or failed job.
- [x] `workflow_failed` preserves a sanitized operator-facing error message.
- [x] Tests cover duplicate/stale events without relying only on process-local
  maps.

## Work Log

### 2026-05-05 - Review Finding

**By:** Codex

**Actions:**
- Reviewed Manager event ingestion and callback ordering behavior.
- Identified process-local idempotency and missing terminal-state checks.

**Learnings:**
- Callback ordering guarantees need to survive restarts and retries, not only a
  single warm process.

### 2026-05-05 - Persisted Callback State

**By:** Codex

**Actions:**
- Persisted accepted event ids, last accepted sequence, last event metadata, and
  terminal callback state in the existing job artifact manifest under
  `agenticSubtitleCallbackState`.
- Re-read the Manager job before applying callback events, dedupe from persisted
  callback state, and ignore stale non-terminal events after terminal jobs.
- Persisted sanitized `workflow_failed` errors into the job errors array.
- Added tests for persisted duplicate dedupe, terminal stale event suppression,
  workflow failure error persistence, and callback state persistence.

**Learnings:**
- The existing metadata artifact manifest is enough for V1 callback idempotency
  without adding a CMS schema or separate event ledger.

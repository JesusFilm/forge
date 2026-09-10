---
id: "feat-247"
title: "Chat conversation delete"
owner: "jian wei"
priority: "P2"
status: "in-progress"
start_date: "2026-09-08"
duration: 7
depends_on:
  - "feat-241"
  - "feat-283"
  - "feat-284"
  - "feat-450"
blocks: []
tags:
  - "web"
  - "ai-pipeline"
---

> **Re-pointed (2026-07-21, Mastra/Seeker architecture-review adjudication):**
> when picked up, this ticket's Mastra route(s) consume the ai-chat lane
> admission module (feat-283) and the thread-ownership read resolver
> (feat-284) instead of mirroring feat-241's hand-rolled read-path patterns —
> the "Expected shape" below predates those modules. Rationale + rulings:
> `docs/handoffs/2026-07-21-mastra-seeker-architecture-review-rulings.md`
> (Sequencing; Rulings 1–2). `depends_on: feat-283, feat-284` added as
> documentation (this lane computes nothing; `blocked` is manual here).

> **Narrowed to delete only (2026-09-02):** rename moved to its own ticket,
> `feat-450` (Chat conversation rename), whose write-route module and proxy
> anatomy this ticket's delete route should join.

## Problem

feat-241 ships view/resume-only server history: signed-in users can list and
continue their persisted Seeker conversations but cannot delete them.
Once history reaches real users (feat-236's public phase), management —
especially deleting a sensitive conversation — becomes expected hygiene.

## Engineering plan

[Chat conversation deletion - Plan](../../plans/2026-09-09-0438-feat-chat-conversation-delete-plan.md) is the implementation contract. The plan specifies three implementation PRs; implementation has not started. The estimate now includes storage enforcement, migration isolation, erasure compatibility, and real-database/browser verification.

## Entry Points — Read These First

1. `docs/plans/2026-09-09-0438-feat-chat-conversation-delete-plan.md` — agreed requirements R1–R17, decisions KTD1–KTD9, implementation units U1–U7, and verification contract.
2. `apps/chat/src/lib/conversation-session.ts` and `use-conversations.ts` — framework-free session state, attempted-send tracking, pending writes, history/replay merging, and React lifecycle.
3. `apps/chat/src/components/shell/sidebar-conversation-list.tsx` and `app-shell.tsx` — per-row rename pattern, confirmation placement, draft preservation, and navigation.
4. `apps/chat/src/app/api/history/write-proxy.ts` and `apps/mastra/src/mastra/ai-chat-history-write-route.ts` — existing write transport, authenticated resource derivation, bounded responses, and SQL failure semantics.
5. `apps/mastra/src/mastra/ai-chat-lane-admission.ts` and `ai-chat-thread-ownership.ts` — mandatory shared admission and ownership seams. A missing live thread must still reach the atomic deletion-record path.
6. `apps/mastra/src/mastra/ai-chat-memory.ts` and `apps/mastra/src/scripts/migrate-mastra-database.ts` — dedicated store and migration plumbing; the existing migrator's history/lock are not chat-isolated.
7. `apps/mastra/src/mastra/ai-chat-erasure.ts`, `ai-chat-retention.ts`, and `workflows/title-repair.ts` — deletion-record lifecycle and exact-owner repair predicates.

## Grep These

- `serverPersisted|renameConversation|deactivate|mergeReplay` — session state and delayed callbacks.
- `refuseUnlessLaneAdmitted|resolveOwnedExistingThread|authorizeAiChatThreadAccess` — access boundaries.
- `getAiChatStorage|generateTitle|saveMessages|saveThread|updateMessages` — actual SDK persistence paths to cover.
- `schema_migrations|forge_devotional_workspace_migrations|migrationsDirectory` — isolation must cover files, history, and locking.
- `runPostgresHalf|threadIds.length|formatPostgresOutcome` — erasure's current live-thread-only early returns and output contract.
- `RECHECK_SQL|TITLE_UPDATE_SQL|ATTEMPTS_INCREMENT_SQL` — repair's candidate-specific exact-owner predicates.

## What To Build

Merge three implementation PRs in order, preserving U1–U7 as traceable units:

1. **PR1 — PostgreSQL foundation and lifecycle compatibility:** all U1/U2; U5 retention/operator-erasure storage cleanup; U7 database/cleanup tests, migration packaging, readiness-transition and planned-restore proof, measurements, and initial runbook. Live coordination rows must be handled as soon as guards activate, even with no delete endpoint or button.
2. **PR2 — Mastra deletion behavior:** U3's Mastra endpoint, admission/ownership, bounded failures/retries, stale-send refusal, and SDK diagnostic sanitization; U5's exact captured-owner scheduled repair; U7 backend/repair/logging tests and operational documentation.
3. **PR3 — Chat integration and user experience:** U3's chat proxy/client/failure mapping; all U4/U6; final U7 browser/full-stack integration, frontend performance, and handoff. Every PR includes appropriate tests; PR3 is not the first testing stage.

**Deployment is separate from merge order.** Deploy PR1's compatible application, workers, and operator tooling first, then explicitly execute its production chat migration. The application must boot safely before migration; lifecycle-dependent cleanup defers with truthful not-ready outcomes until the schema is validated. Pause affected cleanup/operator operations and drain old work during activation, verify guards and maintenance readiness, then resume. An unavailable/partial schema is not clean absence or successful erasure. The plan specifies the full cutover and rollback protocol; PR1 supplies the exact command and execution location.

**Staging assumption, agreed 2026-09-10:** there are currently no users and PR2 will follow PR1 closely. Diagnostic sanitization stays in PR2 and does not gate PR1's migration. Cleanup compatibility remains mandatory in PR1. Deploy PR2 against validated PR1 storage, then PR3 against the ready backend. Keep compatible cleanup after any schema activation and preserve records/guards after deletion; reverting the button alone does not undo storage obligations.

**Planned restore:** PR1's runbook must capture authoritative current deletion records while writes/maintenance are paused, reconcile the restored marker set exactly (including operator-erasure removals), purge matching-owner restored content, and validate before resuming. Missing authoritative recovery state or owner conflicts prevent resumption. Use protected temporary recovery input, not a new permanent journal; remove it after successful reconciliation.

**Completion:** PR1 and PR2 leave feature 247 `in-progress`. Only PR3, after cumulative verification passes, may record the implementation Resolution linking all three actual PRs and update the lane index. Public-release decisions remain separate.

**Owner decisions, recorded 2026-09-09:** B is selected; the backend proceeds with deletion without waiting for generation/background work. Records retain conversation ID and owner/resource ID, with no title/messages, survive ordinary retention, and are removed by operator erasure. Once removed, outstanding requests or valid sessions may recreate previously deleted IDs. This exception does not permit cross-owner disclosure. The plan retains a short A/C/D comparison, including possible future migration to C.

The uncertain-first-send case must become safely deletable, and deletion retries must be idempotent while the record exists. Neither a zero-token failure nor a missing thread is sufficient evidence for unprotected local success.

## Constraints

- Single conversation only, permanent removal, explicit confirmation; no bulk clear, undo, or recovery bin.
- Confirmation describes permanent removal from chat history; it must not claim immediate erasure from every system. Enable deletion only after compatible retention and operator-erasure code is deployed.
- Preserve the full plan Product Contract, including same-tab Stop/reload safety and stale-client write rejection. Instant display synchronization is not required.
- Production storage is dedicated `ai_chat` PostgreSQL. Keep chat migration files, history, and locking independent of unrelated application migrations.
- Single-conversation deletion does not delete Langfuse traces; its existing 25-day retention remains. Operator erasure's Langfuse half remains independent.
- Automatic account deletion remains [feat-356](feat-356-auth-account-deletion-seeker-cascade.md). Public-release acceptance of the operator-erasure exception remains open in [feat-339](feat-339-seeker-public-release-register.md).
- Establish reproducible verification against the final implementation; prototype findings do not establish production initialization, rollout, or complete API correctness.

## Verification

- Run the plan's package tests, type/lint checks, builds, and documentation formatting checks on the eventual implementation.
- Use actual pinned SDK writes against disposable PostgreSQL with deterministic barriers: pending creation, reply/message save, native title, Stop/abort, crash/rollback, lock timeout, stale snapshot, and retry after lost success.
- Verify owner isolation, zero orphan messages, retained deletion records after ordinary retention, and record-only operator erasure with prefix-adjacent owners intact. Retention must recheck recency after locking content rows so native UPDATE-only refreshes are protected.
- Exercise conflicting initial creation and maintenance between reservation and locked read; missing protection is never success. Capture real native SDK failure logs across logger registration/replacement, not only route catches.
- Regression-test owner changes and ID reuse between recall and scheduled-repair publication using synthetic data; every candidate-specific read/write must bind the captured owner.
- Rendered browser: confirmation, inactive draft, active `/` navigation, old links, stale tab, delayed hydration, StrictMode, mobile visibility, focus restoration, and page-load performance.
- The final implementation must pass these checks. Investigation results include intentionally reproduced failures and are not a feature-completion verdict.

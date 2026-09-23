---
id: "feat-544"
title: "Generate draft narration within a durable allowance"
owner: "tataihono"
priority: "P1"
status: "complete"
readiness: "ready-for-agent"
start_date: "2026-09-23"
duration: 3
depends_on: ["feat-542"]
blocks: ["feat-547"]
tags: ["manager", "ai-pipeline"]
---

## Problem

The agent uses an approved existing voice to generate and attach draft speech without pausing for preliminary script approval. The human later reviews effective script and voice settings before publication.

## What To Build

Approved acceptance criteria:

- [x] Delegated draft generation has its own scoped admission and does not fabricate an interactive script approval or weaken human final approval.
- [x] One initial generation and one correction pass are available per project authoring cycle, stable across revisions and client sessions. Further allowance requires explicit human authorization.
- [x] A pass can include multiple speech items. Durable atomic admission prevents concurrent clients, new retry keys, or visual edits from resetting the allowance.
- [x] Unchanged complete effective speech/voice identities reuse existing audio; visual-only revisions make no additional provider calls.
- [x] Duplicate/lost responses reuse the accepted result. Ambiguous paid outcomes reconcile rather than blindly calling the provider again.
- [x] Generated audio attaches atomically with existing linked-timing behavior; a stale completion retains provenance without overwriting newer human edits.
- [x] Allowance use, remaining correction pass, and verified estimate or pricing-unavailable state are visible to both the agent and reviewer. No $5 default is introduced.
- [x] Existing music is the default; new music or voice identity creation remains explicit-request-only. New voice cloning is not implemented.
- [x] Final human review covers complete effective speech and voice settings; delegated generation and inspection do not satisfy publication approval.
- [x] Provider fakes prove initial generation, correction, exhausted allowance, reuse, races, and recovery without paid calls; any real provider smoke is separately recorded and authorized.

## Verification

Test boundary:

Authenticated delegated execution through real authoring persistence and fake provider boundary; human final-review integration.

Read actual package scripts before running targeted Vitest/DB tests, typechecks, lint and formatting. Use only guarded loopback databases and fake paid providers. Regenerate Admin SDL and admin-graphql together if Pothos changes. Record real-client evidence separately from transport probes.

## Constraints

Preserve expected-revision and idempotency semantics, human edits, scoped OAuth authority, and exact-render human approval. No paid provider calls, deployment, agent publication, automatic wakeups, or editor comments.

## Entry Points — Read These First

1. `apps/admin/src/services/studio-authoring/narration.ts`
2. `apps/admin/src/services/studio-authoring/production-rpc.ts`
3. `apps/manager/src/services/studio-production/narration.ts`
4. `packages/studio-contracts/src/production.ts`

See `docs/plans/2026-09-23-studio-external-agent/spec.md` and `code-map.md` for the complete approved scope.

## Grep These

- `authenticateStudioMcp|studioServiceCall|expectedRevision`
- `narrationReserve|render-review|idempotencyKey`

## Implementation evidence — 2026-09-23

- Added migration `0100_studio_delegated_narration`, Prisma models and project-locked admission/allowance service. Project identity is the durable cycle; only interactive, idempotent authorization extends the two-pass allowance.
- Added independently consented `shorts:narration`, `shorts.narrationQuote`, `shorts.narrate` and `shorts.narrationStatus`. The Manager adapter uses the existing production runner and immutable admitted plan.
- Real database tests cover concurrent clients, multi-item initial generation, complete-identity reuse after visual edits, one correction, exhaustion, explicit grants, stale completion, retained attribution, ambiguous claims and human final script/voice approval.
- Existing narration/timing/execution regressions remain green. Fake-provider runner and MCP tests verify accepted-snapshot execution, replay without duplicate calls, and scoped dispatch. No paid calls made.
- Reviewer allowance/authorization UI is integrated by dependent feat-546; real Claude/Codex qualification is tracked by feat-548. Integrated evidence is recorded in the final assessment below.
- Durable learnings: `docs/solutions/security-issues/studio-delegated-narration-allowance.md`.

## Final integration assessment — 2026-09-23

Integrated human-review UI and canonical approval tests pass. Actual Codex used one initial and one correction pass, then admitted unchanged narration with `consumesPass:false` at zero remaining allowance. Exactly two fake provider calls served its cycle; visual-only editing made none. Real-Postgres races, multi-item admission and recovery tests cover additional boundaries. No paid voice-quality or billing claim is made. Both-client/authenticated-UI qualification remains separately open in feat-548.

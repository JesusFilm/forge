---
id: "feat-739"
title: "Run catalog profile recommendations with Sol subscription"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-10-19"
duration: 2
depends_on: []
blocks:
  - "feat-740"
tags: [recommendations, ai-pipeline, subscription]
---

## Problem

The October 19 owner instruction returns to reusable complete-transcript profiles and batched directed candidate judgments, selecting exact `gpt-6.1-sol` for new calls. Preserve existing Astra generations, profiles, results and unknown usage. Shared-reading remains available but its Astra campaign is stopped.

## Entry Points

- `apps/mastra/src/services/precomputed-recommendations/manual-subscription-catalog.ts`: existing manual pipeline and generation digest.
- `apps/mastra/src/services/precomputed-recommendations/codex-subscription-astra.ts`: guarded subscription transport; historical factory name/default retained.
- `apps/admin/src/services/recommendations/precomputed/{durable-build,profile-ledger,edge-ledger}.ts`: immutable model-bound generation, profile cache and physical call ledger.
- `apps/admin/src/services/recommendations/precomputed/generation-retention.ts`: preservation hold through idle abandonment, provisional cleanup and terminal retention.
- `docs/plans/2026-10-19-sol-profile-generation.md`: interface, reuse boundaries, capacity pause and operator command.

## What To Build

Explicit allowlisted model selection across CLI, attestation, transport, generation digest, profile identity and edge reservations. Default Astra keeps old callers compatible. New Sol requires a fresh generation; mismatched attempts/profiles/edges fail closed. Additive database checks allow both exact identities without rewriting rows. Retain complete transcript edition selection, candidate retrieval, evidence, locale and direction validation, private storage and review.

New restart inputs explicitly set `analyticsPolicy: disabled_by_operator_v1` and exact Sol, using protocol4 content-only/observed-fenced. Reject origin/destination/history mixtures and skip GA/import/auth clients entirely. Bind new build/profile/edge revisions; omitted policy preserves historical digests/flow. Null history is intentional, not failed GA. Initial revision0/null proceeds to first real edge revision1; completion retains coverage/capacity/receipt guards and rejects history injection.

Within existing map/reduce calls, `complete-profile-v7-priority-anchors` prioritizes distinct central tension and supported answer/development/outcome where present; never invent resolution or force two anchors. Preserve citations/reference reducers, complete selected text, candidates, schemas and budgets. No new stage or claimed usage/quality improvement. Supplemental private subtitle IDs are not DB chunks and remain outside this patch.

Stopped legacy reservations require a reversible authenticated `capacity_pause` before fresh capacity admission. Protocol3/4 only, exact identity, no open attempts/live leases and explicit physical-stop attestation. Preserve held bytes, measurements, all children and unknown usage; set `capacity_blocked`/`paused`, server blocking time and retention hold with bounded first-pause provenance. Replay is stable; refresh retains provenance/hold. Old physical samples still charge the held growth; obtain a strictly newer sample before excluding it. No cancellation or destructive retirement.

## Constraints

ChatGPT/Codex included subscription only; 25% allowance floor remains default. No paid API/fallback/reset, blind retry of unknown calls, live inference or production writes before coordinator admission. No public activation or direct deployment; normal reviewed PR-to-main. Model availability/context and real calibration must be established locally. Do not infer Sol limits from API advertising or relabel Astra profiles as Sol. Existing ten unknown legacy edge calls remain unknown.

## Verification

Focused tests for exact transport argv/provenance, no paid/tool fallback, generation/profile/edge model identity, old Astra compatibility, mismatched model refusal and SQL allowlist. Run touched lint/format, typechecks and independent review before coordinator calibration. Add disposable native checks for capacity pause/replay/preservation, active-work refusal, row-lock races, old/fresh sample charging, retention and original-model resumption. Add no-GA start/resume with throwing GA ports, exact old digest compatibility, v7 full-text/citation/reference replay, revision1 resume, history-injection refusal and native completion/unknown/capacity refusal. Public control stays untouched. Do not mark complete based only on offline tests.

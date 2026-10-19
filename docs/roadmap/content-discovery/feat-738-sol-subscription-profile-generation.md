---
id: "feat-738"
title: "Run catalog profile recommendations with Sol subscription"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-10-19"
duration: 2
depends_on:
  - "feat-590"
blocks: []
tags: [recommendations, ai-pipeline, subscription]
---

## Problem

The October 19 owner instruction returns to reusable complete-transcript profiles and batched directed candidate judgments, selecting exact `gpt-6.1-sol` for new calls. Preserve existing Astra generations, profiles, results and unknown usage. Shared-reading remains available but its Astra campaign is stopped.

## Entry Points

- `apps/mastra/src/services/precomputed-recommendations/manual-subscription-catalog.ts`: existing manual pipeline and generation digest.
- `apps/mastra/src/services/precomputed-recommendations/codex-subscription-astra.ts`: guarded subscription transport; historical factory name/default retained.
- `apps/admin/src/services/recommendations/precomputed/{durable-build,profile-ledger,edge-ledger}.ts`: immutable model-bound generation, profile cache and physical call ledger.
- `docs/plans/2026-10-19-sol-profile-generation.md`: interface, reuse boundaries and operator command.

## What To Build

Explicit allowlisted model selection across CLI, attestation, transport, generation digest, profile identity and edge reservations. Default Astra keeps old callers compatible. New Sol requires a fresh generation; mismatched attempts/profiles/edges fail closed. Additive database checks allow both exact identities without rewriting rows. Retain complete transcript edition selection, candidate retrieval, evidence, locale and direction validation, private storage and review.

## Constraints

ChatGPT/Codex included subscription only; 25% allowance floor remains default. No paid API/fallback/reset, blind retry of unknown calls, live inference or production writes before coordinator admission. No public activation or direct deployment; normal reviewed PR-to-main. Model availability/context and real calibration must be established locally. Do not infer Sol limits from API advertising or relabel Astra profiles as Sol. Existing ten unknown legacy edge calls remain unknown.

## Verification

Focused tests for exact transport argv/provenance, no paid/tool fallback, generation/profile/edge model identity, old Astra compatibility, mismatched model refusal and SQL allowlist. Run touched lint/format, typechecks and independent review before coordinator calibration. Do not mark complete based only on offline tests.

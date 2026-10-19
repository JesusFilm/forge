---
id: "feat-740"
title: "Qualify Sol content-only recommendation experiments"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: "2026-10-21"
duration: 2
depends_on:
  - "feat-739"
blocks: []
tags: [recommendations, experiments, admin, web]
---

## Problem

The October 19 owner direction selects the existing profile/candidate generator with `gpt-6.1-sol` and explicitly disables Google Analytics ingestion. Its protocol-4 content-only results can complete and be reviewed privately, but public experiment readiness still requires Astra and a qualified GA capture. A separate reviewed readiness path is needed before these results can be offered for an A/B test. Producing the catalog does not authorize public activation.

## Entry Points

- `apps/admin/src/services/recommendations/precomputed/live-readiness.ts`: model, input mode and qualification requirements for experiment admission.
- `apps/admin/src/services/recommendations/precomputed/launch-capacity.ts`: launch capacity and capture requirements.
- `apps/admin/src/services/recommendations/precomputed/durable-build.ts`: completed protocol-4 content-only source coverage and generation identity.
- `apps/mastra/src/services/precomputed-recommendations/manual-subscription-catalog.ts`: `disabled_by_operator_v1`, content-only build identity and Sol profile/edge versions.
- `docs/roadmap/content-discovery/feat-590-precomputed-video-recommendation-experiment.md`: experiment rollout, attribution and separate activation scope.

## Grep These

`historical_analytics`, `content_only`, `qualified`, `gpt-6-astra`, `gpt-6.1-sol`, `disabled_by_operator_v1`, `RecommendationStrategyManifest`.

## What To Build

Recognize the exact reviewed Sol/content-only generation contract explicitly in readiness while retaining the historical analytics path. Require completed catalog/source coverage, valid directional evidence, reconciled known/unknown call usage, an immutable generation and current capacity evidence. Report intentional absence of analytics honestly; do not manufacture qualification or treat it as a failed capture. Document the specific generation and readiness proof that can be submitted for owner approval of public activation.

## Constraints

Public activation remains a separate owner decision. This ticket does not regenerate recommendations or ingest GA. Preserve experiment attribution, private review, incumbent fallback and rollback controls; dropping GA as a generation input does not disable product analytics or experiment measurement. Do not globally bypass model, evidence, usage, capacity or readiness guards.

## Verification

Focused positive tests for the exact completed Sol/content-only version and negative tests for incomplete coverage, unknown usage, wrong version/model and inadequate capacity. Historical readiness tests remain valid. Exercise the private readiness result against a completed retained generation, with public control unchanged, before presenting a concrete activation decision.

---
id: "feat-049"
title: "Alternative Transcription and Translation Models"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-04-13"
duration: 18
depends_on:
  - "feat-031"
blocks:
  - "feat-065"
  - "feat-066"
  - "feat-397"
tags:
  - "manager"
  - "ai-pipeline"
  - "quality"
---

## Problem

The current enrichment stack has a working transcription and translation path, but quality may plateau if we only use one provider combination. We need a structured comparison across alternative speech-to-text and translation providers, including DeepL, so future quality improvements are driven by evidence on accuracy, cost, latency, and operational fit.

## Entry Points — Read These First

1. `apps/manager/src/services/transcription.ts` — current transcription provider and artifact format
2. `apps/manager/src/services/translation.ts` — current translation provider and prompt shape
3. `apps/manager/src/services/openrouter.ts` — existing model client pattern
4. `apps/manager/src/workflows/videoEnrichment.ts` — step boundaries where provider selection plugs in
5. `apps/manager/src/types/job.ts` — workflow step names and options that may need provider flags
6. `apps/manager/.env.example` — provider configuration surface

## Grep These

- `Mux` in `apps/manager/src/services/transcription.ts`
- `translate` in `apps/manager/src/services/translation.ts`
- `process.env|env.` in `apps/manager/src/`
- `workflow step` in `apps/manager/src/types/job.ts`

## What To Build

1. Compare the current transcription and translation stack against at least one alternative STT provider and at least one alternative translation provider, including DeepL.
2. Capture a benchmark matrix for quality, latency, cost, supported languages, speaker handling, and operational complexity.
3. Add a provider abstraction only where it materially reduces future swap cost; avoid overengineering if one provider clearly wins.
4. Recommend the default provider combination for production and document when the fallback path should be used.
5. Leave the production default unchanged unless the benchmark clearly justifies a switch.

## Constraints

- Do NOT turn this ticket into a full provider migration unless the benchmark outcome is decisive.
- Keep provider secrets and account setup out of the repo.
- Compare using the same representative asset set so results are actually comparable.

## Verification

- Produce a benchmark table for transcription and translation quality with concrete sample assets
- Confirm DeepL is included in the translation comparison
- Document a clear production recommendation and any follow-up migration ticket needed

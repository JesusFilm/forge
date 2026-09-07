---
id: "feat-458"
title: "Studio generation and narration review"
owner: "tataihono"
priority: "P1"
status: "in-progress"
start_date: "2026-09-07"
duration: 5
depends_on:
  - "feat-452"
  - "feat-455"
  - "feat-456"
  - "feat-457"
blocks:
  - "feat-460"
tags:
  - "ai-pipeline"
  - "manager"
---

## Problem

The proven creative pipeline must become explicit, resumable project operations with script review before narration and fast incremental changes.

## Entry Points — Read These First

1. `docs/plans/2026-09-07-001-feat-studio-video-authoring-plan.md` — full contract, rollout and verification design.
2. `apps/mastra/src/services/devotional/`
3. `apps/mastra/src/mastra/agents/devotional/`
4. `apps/manager/src/workflows/shortsStudio.ts`
5. `apps/manager/src/features/video-studio/ (proposed)`
6. `packages/studio-contracts/ (proposed)`

Paths marked proposed do not exist yet. Frontmatter dates/durations are planning placeholders, not delivery commitments.

## Grep These

- `buildNarrationSegments|settleLine|reflection-modernizer|reviewDevotionalText|text-approved`

## What To Build

1. Port Lyuba creative/source-selection and QA behavior into the new hosted agent/tool path, with editable prompt defaults instead of permanent layout or writing-style bans.
2. Explicit single/batch production builds script, composition and source preview. No calendar planning call can trigger this path or pay for narration.
3. Approve the complete spoken script, then generate per-segment narration with identity covering role/text/language/voice/model/settings/pronunciation dependencies.
4. Implement linked duration ripple and explicit timing locks; visual changes reuse speech, changed speech invalidates dependent approvals and audio.
5. Persist bounded attempt references, costs and errors; support restart/retry/cancel and retain stale output assets without attaching them over newer edits.

6. Implement the explicit music/voice experiment operation and UI: estimated cost, user-requested provider generation, retained candidate provenance, audition, selection and registration. It is separate from automatic planning and from project narration approval.

## Constraints

- No fixed devotional content arrangement in project schemas.
- No automatic regeneration of new music or voices when an existing asset is unsuitable; request explicit creative action.
- Do not trust the old CLI approval path: bridge/settle lines must be included and quality findings must remain inspectable.

## Verification

- Test script gate, exact spoken-text fingerprints, partial regeneration, style-only reuse, timing locks and stale completion after manual edits.
- Run saved-example content checks with source attribution and operator comparison; record actual generation cost/time.
- Prove restart/idempotency behavior and that planner-only calls cannot reach TTS/render.

- Exercise explicit music/voice audition and selection; a library miss alone must not spend credits, and unused candidates remain stored.

## Implementation checkpoint

Reviewed implementation and verification are recorded in `docs/validation/studio-458/HANDOFF.md` and `docs/solutions/security-issues/studio-approved-production-and-retained-results.md`. Status remains in progress: paid native-hosted creative quality is partial/failing, and actual ElevenLabs narration/music/voice proof awaits verified billing/slot facts and explicit authorization. Deterministic orchestration evidence does not complete those acceptance requirements.

Closed paired model comparison and the independently reviewed replay/deadline correction are recorded in `docs/validation/studio-458/model-comparison-1/README.md` and `docs/validation/studio-458/replay-deadline-fix/README.md`. Fourteen claims were consumed (one ambiguous); the remaining slots were not run. No additional provider execution is authorized.

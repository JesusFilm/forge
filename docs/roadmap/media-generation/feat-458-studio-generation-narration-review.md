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

### Canonical effective-speech feedback checkpoint

The narrow correction returns complete bounded canonical speech (or explicit unavailability) after ordered proposal validation, binds original operations before clone-isolated projection, and clarifies existing set-text/set-speech tool semantics. See `docs/solutions/integration-issues/studio-effective-speech-feedback.md` and `docs/validation/studio-458/effective-speech-feedback/README.md`. Closed paid artifacts remain unchanged. New tool description bytes require fresh admission for any future paid evaluation. The bounded interleaved frontend comparison is recorded as inconclusive, not a no-regression pass. Creative and ElevenLabs acceptance remain incomplete; ticket stays in progress.

### Retained generation-command isolation checkpoint

`generation.read` now clones the selected operations only for projection, preserving original response command provenance alongside the unchanged final document. See `docs/solutions/integration-issues/studio-generation-read-command-isolation.md` and `docs/validation/studio-458/generation-read-isolation/README.md`. Existing 680 evidence entries, closed paid batches, tool/prompt bytes and the inconclusive performance limitation remain unchanged. Full creative/ElevenLabs acceptance remains open.

## Narration pricing follow-up — 2026-09-11

Implemented owner-authorized narration and voice setup without an account rate
card. Unknown estimates/actual costs remain explicit; mixed scripts preserve the
known reservation subtotal. Focused tests/types/review passed. Live speech test
succeeded. See `docs/solutions/integration-issues/shorts-narration-without-account-pricing.md`.

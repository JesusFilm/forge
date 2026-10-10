---
date: 2026-04-12
topic: manager-cleaned-audio-review-links
---

# Manager Cleaned Audio Review Links

## Problem Frame

The manager job detail flow already lets operators inspect text artifacts and a few richer comparison states, but it does not let them listen to audio before and after noise cleaning. For a review-oriented audio cleanup flow, that leaves the operator blind at the exact point where subjective QA matters most.

V1 should stay narrow: when manager runs audio cleanup through ElevenLabs voice isolation, the resulting job detail should let the operator open both the original audio and the cleaned audio from the normal job detail experience. This is for manager QA only, not CMS rollout or downstream product playback.

## Requirements

- R1. When audio cleanup runs, the job must persist two review artifacts: `original-audio` and `cleaned-audio`.
- R2. The job detail must expose both artifacts as clearly labeled review links in the existing manager job detail experience.
- R3. V1 remains manager-only. No CMS content-type writes, no language-audio-preview sync, and no public product rollout are included.
- R4. Audio artifacts must use the same protected artifact-serving model as existing manager job artifacts.
- R5. The design must stay additive so a later CMS sync or richer compare UI can be added without rewriting the artifact contract.
- R6. The feature must include a real user smoke test on a completed manager job.

## Success Criteria

- A completed job with audio cleanup exposes labeled `Original audio` and `Cleaned audio` links.
- Both links resolve through the manager artifact route and open playable audio files.
- Operators can compare the cleaned result against the original audio without leaving the job detail page.
- Jobs that do not run audio cleanup do not show misleading empty audio-review UI.
- The implementation remains local to `apps/manager` and job-state artifacts.

## Scope Boundaries

- No CMS schema change or GraphQL codegen work.
- No new compare card, override workflow, or editor-style waveform UI.
- No product-surface playback integration.
- No attempt to redesign the rest of the enrichment pipeline while adding audio review.

## Key Decisions

- **Manager-only first**: keep the feature inside job artifacts and manager UI until the review flow proves useful.
- **Two persisted artifacts**: `original-audio` and `cleaned-audio` are both durable job artifacts, not one artifact plus an external playback link.
- **Explicit provider choice**: use ElevenLabs voice isolator for v1 rather than a provider-selection abstraction.
- **Readable review links, not a compare card**: keep the UI lightweight and obvious.
- **Audio cleanup is additive**: it should not force a CMS sync design decision in the same slice.

## Resolved Questions

- **What should the review experience be?** Two listen links: `Original audio` and `Cleaned audio`.
- **Should cleaned audio sync into CMS?** No. Keep it as a job artifact only for now.
- **What should `Original audio` point to?** A persisted `original-audio` artifact, not the existing Mux player link.
- **What defaults should planning assume?**
  - use sane repo-local defaults without more clarification rounds
  - require Red/Green TDD in implementation planning
  - require a user smoke test in implementation planning

## Next Steps

-> `/workflows:plan` for structured implementation planning

---
date: 2026-04-08T00:00:00.000Z
topic: manager-pipeline-transparency
---

# Pipeline Transparency Workspace for Manager App

## Problem Frame

The manager app already exposes a coverage report and job-step detail, but it still hides the evidence behind AI outputs. Operators can see that transcription, translation, metadata, and voiceover steps ran, yet they cannot quickly inspect what was produced, why it should be trusted, or where quality is weak. That makes the current surfaces useful for status, but weak for QA and decision-making.

## Requirements

- R1. Add a dedicated per-video transparency workspace in the manager app for inspecting enrichment outputs end to end.
- R2. The workspace is organized into clear inspection sections for Transcription, Translation, Metadata, and Audio/Voiceover rather than a single mixed artifact list.
- R3. Every section shows provenance: source language, model/provider, timestamps, workflow step status, and whether the output is human-verified, AI-generated, or missing.
- R4. Transcription inspection surfaces cue gaps, low-confidence segments, and downloadable source artifacts such as VTT and normalized transcript JSON.
- R5. Translation and metadata inspection show side-by-side source vs. generated output, including per-language diffs and prompt/result summaries where available.
- R6. Operators can compare one video across multiple target languages from the same screen.
- R7. Failed or suspicious steps can be re-run from the transparency workspace without navigating back to the queue.

## Success Criteria

- A reviewer can open one video and understand the full enrichment state without jumping between the report, jobs list, and raw artifacts.
- Quality issues in transcription, translation, or metadata are discoverable before the content is pushed downstream.
- The workspace makes AI output trust explicit instead of implied.

## Scope Boundaries

- Not a full subtitle or metadata editing suite.
- Not a replacement for Strapi authoring.
- Not a new pipeline architecture; this visualizes and controls the existing pipeline first.

## Key Decisions

- The primary unit is a single video/job transparency page, not another global summary dashboard.
- Transparency is about drill-down evidence and provenance, not top-level report navigation.
- Provenance is first-class UI, not buried in downloadable JSON.

## Dependencies / Assumptions

- Existing artifact storage in `apps/manager/src/services/storage.ts` remains the source of truth for first-pass inspection.
- The workflow already emits enough step-level metadata to power an initial transparency UI, with confidence heuristics added incrementally.

## Outstanding Questions

### Deferred to Planning

- [Affects R4][Technical] Should confidence warnings come from provider-native confidence data, subtitle heuristics, or a secondary evaluator step?
- [Affects R7][Technical] Should re-run actions enqueue full jobs or allow step-scoped retries for a single language/output?

## Next Steps

-> `/ce:plan` for structured implementation planning

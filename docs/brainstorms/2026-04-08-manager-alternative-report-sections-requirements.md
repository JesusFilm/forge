---
date: 2026-04-08T00:00:00.000Z
topic: manager-alternative-report-sections
---

# Alternative Report Sections for Manager App

## Problem Frame

The manager app already distinguishes subtitles, audio, and metadata conceptually, but the reporting experience still feels centered on one generalized coverage surface. Operators need first-class report sections for different output types because each one has different questions, metrics, and workflows. A subtitle report should emphasize language coverage and QA readiness, an audio report should emphasize voiceover availability and listenability, and a metadata report should emphasize title, description, topic completeness, and provenance.

Without dedicated report sections, the reporting model stays technically correct but operationally blurry. Teams can tell that something exists, but not whether they are looking at the right layer of the pipeline for the decision they need to make.

## Requirements

- R1. The manager app exposes separate top-level report sections for at least `Subtitles`, `Audio / Voiceover`, and `Metadata`.
- R2. Each report section has its own summary metrics, filters, and row or card presentation tuned to that output type rather than reusing a one-size-fits-all layout.
- R3. Report sections share common navigation and filtering primitives so users can switch between them without relearning the app.
- R4. Every report section can deep-link into the relevant per-video transparency or playback workflow when a user wants detail.
- R5. Subtitle reporting emphasizes language coverage, verification state, and QA follow-up.
- R6. Audio reporting emphasizes voiceover existence, language availability, and playback readiness.
- R7. Metadata reporting emphasizes title, description, topics, tags completeness, source provenance, and downstream publish readiness.

## Success Criteria

- A manager can open the right report section for the job at hand instead of mentally translating one generic report.
- The app makes it obvious that subtitles, audio, and metadata are different operational domains with different readiness signals.
- Report-level decisions and drill-down workflows feel connected rather than duplicated.

## Scope Boundaries

- Not a replacement for the per-video transparency workspace.
- Not a new analytics warehouse or BI product.
- Not a complete redesign of every manager dashboard page.

## Key Decisions

- Alternative report sections are their own feature, separate from per-video transparency.
- The split is by output domain, not by internal storage format or workflow step implementation.
- Shared navigation is preserved, but content inside each section is specialized.

## Dependencies / Assumptions

- The current manager report patterns already provide a starting shell for shared filters, routing, and language selection.
- Detailed inspection and playback actions will live in adjacent workflows rather than inside the report cards themselves.

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Technical] Should each report section be a dedicated route, a tab system, or a hybrid with route-backed tabs?
- [Affects R2][Product] Which metrics are mandatory for v1 in each section so the split feels justified instead of cosmetic?

## Next Steps

-> `/ce:plan` for structured implementation planning

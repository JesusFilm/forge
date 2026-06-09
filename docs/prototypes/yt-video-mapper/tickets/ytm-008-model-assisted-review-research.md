---
id: YTM-008
title: "Research model-assisted video review as a later layer"
status: backlog
priority: P3
depends_on:
  - YTM-006
---

# YTM-008: Research model-assisted video review as a later layer

## Goal

Evaluate whether an AI model should help review or explain difficult matches
after the deterministic media-signature pipeline exists.

## Scope

- Treat model-assisted review as optional and downstream of fingerprinting,
  retrieval, and evaluation.
- Test whether model review helps with ambiguous candidate shortlists,
  heavily-edited clips, or explanation for human review.
- Avoid making model output the only proof for analytics attribution.
- Compare cost, latency, and reliability against the existing retrieval/fusion
  baseline.

## Acceptance Criteria

- Research report explains where model assistance adds measurable value.
- Recommendation is grounded in labeled evaluation cases from YTM-006.
- No production matching path depends solely on model judgment.

## Verification

```sh
pnpm --filter @forge/yt-video-mapper-backend test
```

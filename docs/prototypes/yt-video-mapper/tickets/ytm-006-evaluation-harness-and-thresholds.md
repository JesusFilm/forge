---
id: YTM-006
title: "Add evaluation harness and confidence thresholds"
status: todo
priority: P1
depends_on:
  - YTM-005
---

# YTM-006: Add evaluation harness and confidence thresholds

## Goal

Measure whether the mapper is good enough for analytics attribution before
trusting confidence labels operationally.

## Scope

- Create a small labeled evaluation set of uploaded/reuploaded samples with
  expected `coreId` and expected or acceptable `videoVariantId`.
- Support full reuploads, clips, crops, overlays, compression changes, and
  language/dub ambiguity cases.
- Add an evaluation runner that reports top-1 accuracy, top-k recall,
  no-match/low-confidence behavior, and confusion cases.
- Calibrate thresholds for `matchStrength: "high" | "medium" | "low"`.
- Document when callers should accept the top candidate versus inspect the
  shortlist.

## Acceptance Criteria

- Evaluation can run locally against seeded or synced mapper data.
- Thresholds are justified by labeled examples, not vibes.
- Reports include enough detail to tune fusion without exposing internal
  evidence through the public API.
- CI has a small deterministic test set; larger media-heavy evaluation can be
  manual or scheduled.

## Verification

```sh
pnpm --filter @forge/yt-video-mapper-backend test
pnpm --filter @forge/yt-video-mapper-backend typecheck
```

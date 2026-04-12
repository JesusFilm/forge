---
status: complete
priority: p2
issue_id: "029"
tags: [code-review, reliability, manager, mux]
dependencies: []
---

# Degrade Mux Review Track Failures

## Problem Statement

An unsupported or unresolvable Mux subtitle track currently fails the entire review context. That prevents metadata, chapters, and generated artifact tracks from rendering even though only the live Mux subtitle lookup failed.

## Findings

- `apps/manager/src/features/jobs/review-player/load-job-review-context.ts:335` catches any `loadMuxSubtitleTracks()` error and returns a top-level `status: "failed"`.
- `apps/manager/src/services/mux.ts:144` can throw for DRM playback IDs, and `apps/manager/src/services/mux.ts:153` can throw when signed playback assets lack signing keys.
- The review context already has per-domain unavailable/failed states, so the Mux subtitle path can degrade without taking down the whole card.

## Proposed Solutions

### Option 1: Treat Mux Subtitle Lookup Errors as No Live Mux Tracks

**Approach:** Catch Mux subtitle lookup failures and keep `muxTracks = []`, allowing CMS subtitles and generated artifacts to render.

**Pros:**

- Simple, resilient behavior.
- Matches the review card’s partial-availability model.

**Cons:**

- Operators may not immediately see why Mux tracks are absent unless the reason is surfaced.

**Effort:** 30-60 minutes

**Risk:** Low

### Option 2: Add a Per-Domain Subtitle Failure State

**Approach:** Preserve a subtitle-domain failure reason for the before side while still returning the rest of the review context.

**Pros:**

- More transparent for operators.

**Cons:**

- Requires a small type/presenter/UI update.

**Effort:** 1-2 hours

**Risk:** Medium

## Recommended Action

Completed Option 1: treat Mux subtitle lookup errors as unavailable live Mux tracks while preserving the rest of the review context.

## Technical Details

**Affected files:**

- `apps/manager/src/features/jobs/review-player/load-job-review-context.ts`
- `apps/manager/src/features/jobs/review-player/review-player-types.ts`
- `apps/manager/src/services/mux.ts`

## Resources

- Review finding from TypeScript/correctness review on 2026-04-12.

## Acceptance Criteria

- [x] DRM or unsigned signed-playback subtitle lookup does not fail the whole review context.
- [x] Generated metadata and chapters still render when live Mux subtitle lookup fails.
- [x] Tests cover Mux subtitle lookup failure degradation.

## Work Log

### 2026-04-12 - Initial Discovery

**By:** Codex

**Actions:**

- Traced `listMuxSubtitleTracks()` errors through `loadJobReviewContext()`.
- Confirmed current behavior returns top-level failed status for a subtitle-only issue.

**Learnings:**

- Review panels should isolate optional data-source failures so one unavailable comparison source does not hide unrelated generated artifacts.

### 2026-04-12 - Review Fix

**By:** Codex

**Actions:**

- Changed `loadJobReviewContext()` to catch live Mux subtitle lookup errors and continue with an empty Mux track list.
- Added a regression test proving the context remains ready and generated metadata/chapters still render after a Mux lookup error.
- Verified with the review-context test suite.

**Learnings:**

- Optional live comparison data should degrade locally inside its domain instead of converting the whole review card to a failed state.

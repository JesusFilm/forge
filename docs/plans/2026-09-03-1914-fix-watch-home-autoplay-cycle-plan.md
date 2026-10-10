---
title: "Watch Home Autoplay Cycle Fix"
type: fix
date: "2026-09-03"
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
roadmap: docs/roadmap/content-discovery/feat-452-watch-home-autoplay-cycle.md
---

# Watch Home Autoplay Cycle Fix

## Goal Capsule

- **Objective:** Keep the Watch homepage intro playing the next eligible video
  after the current one ends, including when the viewer's stored history has
  reached the end of the available catalog cycle.
- **User-visible outcome:** A returning viewer with multiple playable landscape
  videos never lands in a false one-video queue; the ended event changes to a
  different video and autoplay continues.
- **Authority:** The user's fix request, the repository execution rules, the
  existing carousel parity contract, and this plan.
- **Execution profile:** Small web-only bug fix with pure queue tests and a
  rendered playback regression.
- **Tail ownership:** LFG owns implementation, verification, review, commit,
  push, PR creation, and CI babysitting. Production remains on the normal
  PR-to-main path.

## Product Contract

### Summary

The post-mount random hero selection already falls back to the full playable
catalog after every candidate has been played. Queue construction does not have
the same cycle rollover: it filters follow-on candidates using persistent and
per-pool history until only the selected hero remains. Advancing a one-item
queue calculates index zero again, leaving the keyed player unchanged and the
ended video stopped.

### Problem Frame

The failure is reproducible without network or timing dependencies. Given three
playable videos, history containing the first two, and the third as the selected
hero, `buildWatchHomeVideoQueue` returns only that hero. With all three in
history, it has the same result. `advance` then wraps from index zero to index
zero, so React does not mount a fresh media element.

This contradicts the existing sequence-parity requirement that exhaustion reset
prevents the carousel from dead-ending and the random-hero behavior that cycles
back through played videos after the whole eligible library has been seen.

### Requirements

- **R1:** Queue construction MUST prefer unplayed, non-excluded, playable videos
  while enough such candidates exist.
- **R2:** When stored progress cannot fill the requested queue, construction
  MUST start a selection-only rollover pass and use previously played
  candidates until the target is reached or the distinct eligible catalog is
  exhausted, without duplicating an item already in the active queue.
- **R3:** Cycle rollover MUST preserve persistent and per-pool progress. The
  rollover pass ignores that progress only for candidate selection, so future
  random-hero draws retain the complete viewing history and can apply their
  existing full-catalog fallback without immediately forgetting the last hero.
- **R4:** Hard exclusions, including measured portrait video IDs, MUST remain
  excluded in both the first pass and rollover pass.
- **R5:** When the catalog contains N distinct eligible videos and N is smaller
  than the requested queue length, construction MUST return exactly those N
  items and terminate, including N = 0 (empty queue) and N = 1 (hero only). It
  MUST NOT loop, duplicate, or fabricate items to reach the target. For N = 1,
  the ended video remains stopped because no distinct next video exists.
- **R6:** For two or more eligible videos, an `ended` event MUST select a
  different slide and allow the new media item to autoplay through the existing
  keyed-player behavior.

### Acceptance Examples

- **AE1a:** With eligible videos A, B, and C, played history `[A, B]`, and C as
  the active random hero, the queue begins with C and contains at least one of A
  or B after rollover.
- **AE1b:** With that queue rendered, ending C activates a different ID and
  requests playback for the new media item.
- **AE2:** With A, B, and C all present in played and per-pool session history,
  a rollover queue still contains distinct eligible videos, while both storage
  records remain intact for later hero selection and progressive fills.
- **AE3:** A measured portrait video is never appended during rollover.
- **AE4:** With only A eligible, queue construction returns only A, terminates
  normally, and ending A preserves the existing stopped one-item behavior.
- **AE5:** With no eligible video, queue construction returns an empty queue and
  does not run a rollover pass.

### Scope Boundaries

- Only the Watch homepage intro carousel in `apps/web` is in scope.
- Detail-page episode autoplay, `apps/mobile`, `apps/tv`, carousel styling,
  GraphQL contracts, and server content resolution are out of scope.
- No new fetches, dependencies, storage keys, or render-time randomness.

## Planning Contract

### Key Technical Decisions

- **KTD1 (governs R1, R2, R4, R5):** Keep the existing history-aware pass as
  the preferred path. If it exhausts before the requested target, run one
  bounded rollover pass over the same pool data with progress filters disabled,
  while retaining the queue's `seen` set and hard-exclusion set. Stop when the
  target or the distinct eligible catalog size is reached. This preserves the
  active hero, prevents immediate duplicates, and bounds small-catalog work.
- **KTD2 (governs R2, R3):** Treat rollover as a queue-selection fallback, not a
  storage cycle boundary. Do not clear monthly or per-pool progress; the second
  pass simply does not consult those filters. Queue-level rollover is preferred
  over special-casing `advance` because it also guarantees that a distinct next
  item is loaded for ended, progress-threshold, and manual-next paths.
- **KTD3 (governs R6):** Prove the user behavior at the rendered page boundary
  by firing the media `ended` event and asserting that the active source/ID
  changes and playback is requested. A manual Next-button assertion alone is
  insufficient because the reported bug is automatic continuation.
- **KTD4 (governs R1-R6):** Keep queue rollover selection in the sequence
  module without adding new storage writes;
  leave the hook's advance arithmetic and keyed media rendering unchanged unless
  the regression demonstrates an independent defect.

### Assumptions

- Reusing previously played videos after full exhaustion is intended. This is
  grounded in `pickRandomWatchHomeHeroVideo`, which falls back to the full
  playable candidate set, and the earlier sequence-parity plan's explicit
  exhaustion-reset requirement.
- “Go to the next video” means a distinct eligible item when one exists; no
  distinct next item exists for a one-video catalog.

### Risks and Mitigations

- **Risk:** Rollover could replay the current hero immediately. **Mitigation:**
  retain the queue-wide `seen` set across passes and add AE1a coverage.
- **Risk:** Ignoring progress on rollover could re-admit portrait videos.
  **Mitigation:** exclusions remain hard filters independent of progress,
  covered by AE3.
- **Risk:** Recursive or unbounded refill could spin on tiny catalogs.
  **Mitigation:** use at most one explicit second pass with the existing attempt
  bound, covered by AE4.
- **Risk:** New queue work could affect page loading. **Mitigation:** the fix is
  synchronous in-memory filtering over the already delivered pool payload,
  introduces no request/dependency/render loop, and is checked in browser/build
  verification.

## Implementation Units

### U1. Add Cycle-Rollover Primitives

**Goal:** Make queue exhaustion start one clean, bounded cycle without weakening
eligibility rules.

**Requirements:** R1, R2, R3, R4, R5.

**Dependencies:** None.

**Files:**

- `apps/web/src/lib/watch-home-carousel-sequence.ts`
- `apps/web/src/lib/watch-home-carousel-sequence.test.ts`

**Approach:** Refactor queue filling into a bounded pass that can be run first
with progress filtering and, only when a distinct candidate outside `seen`
exists, once without it. Carry the same `videos`, `seen`, and `excluded` state
across both passes. Do not mutate browser storage during rollover.

**Test scenarios:**

- AE1a: partial played history fills past the active hero with a distinct replay.
- AE2: full persistent and pool history stays intact while a multi-item queue
  fills.
- AE3: hard-excluded IDs remain absent on rollover.
- AE4 and AE5: one-video and zero-video catalogs terminate at their distinct
  eligible size.
- A two-to-six-video catalog with a target of seven does not duplicate or spin
  once every eligible ID is already present in the queue.
- Existing deterministic/random offsets, progressive fill, and 50-item cycle
  tests continue to pass.

### U2. Prove Ended-Event Autoplay Continuation

**Goal:** Lock the queue fix to the reported rendered behavior.

**Requirements:** R6, supported by R1-R5.

**Dependencies:** U1.

**Files:**

- `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx`
- `apps/web/src/components/home/__tests__/useWatchHomeTvCarousel.test.ts`
  only if hook-level isolation is needed to make the lifecycle assertion stable.

**Approach:** Seed browser storage so the random hero is the final unplayed
video, render the homepage with at least three eligible slides, dispatch the
active media element's `ended` event, and assert a different video becomes
active and receives the existing play request. Avoid coupling the test to a
specific random ordering beyond the distinct-ID contract.

**Test scenarios:**

- AE1b: the final unplayed hero advances to a previously seen,
  distinct video.
- Existing explicit Next, portrait-skip, mute, hydration, and fallback timing
  tests continue to pass.

### U3. Close Roadmap and Performance Evidence

**Goal:** Leave the repository's durable tracking and loading-risk record
accurate.

**Requirements:** R1-R6.

**Dependencies:** U1, U2.

**Files:**

- `docs/roadmap/content-discovery/feat-452-watch-home-autoplay-cycle.md`

**Approach:** Record the exact implementation and verification, note that the
change adds no network request/dependency/render-time loop, and set the ticket
to `complete` only after required checks pass.

## Verification Contract

Run from the repository root:

```bash
pnpm --filter @forge/web test -- src/lib/watch-home-carousel-sequence.test.ts src/components/home/__tests__/useWatchHomeTvCarousel.test.ts src/components/home/__tests__/WatchHomePage.test.tsx
pnpm --filter @forge/web typecheck
pnpm --filter @forge/web lint -- src/lib/watch-home-carousel-sequence.ts src/lib/watch-home-carousel-sequence.test.ts src/components/home/__tests__/WatchHomePage.test.tsx
pnpm prettier --check docs/plans/2026-09-03-1914-fix-watch-home-autoplay-cycle-plan.md docs/roadmap/content-discovery/feat-452-watch-home-autoplay-cycle.md apps/web/src/lib/watch-home-carousel-sequence.ts apps/web/src/lib/watch-home-carousel-sequence.test.ts apps/web/src/components/home/__tests__/WatchHomePage.test.tsx
pnpm --filter @forge/web build
git diff --check
```

Browser QA MUST exercise the Watch homepage with played history that leaves one
unplayed hero, finish that hero, and observe a different video start. If the
local page cannot render because Admin GraphQL is unavailable, capture the exact
environment blocker and rely on the rendered jsdom regression plus build checks;
do not claim visual browser proof.

Loading-performance verification is structural and build-backed: confirm the
diff adds no import dependency, fetch, image, server query, timer, or effect and
does not widen the serialized carousel payload. Any unexpected bundle-size or
route-rendering change blocks completion.

## Definition of Done

- U1-U3 are complete and all acceptance examples are covered.
- Focused sequence, hook, and rendered page tests pass.
- Web typecheck, lint, formatting, build, and `git diff --check` pass.
- Browser QA passes or records the exact local Admin/preview blocker without
  overstating evidence.
- Loading behavior is unchanged apart from bounded in-memory queue rollover.
- The roadmap ticket is `complete` with verification notes.
- Simplification and code-review findings are resolved or durably recorded.
- The branch is committed, pushed, opened as a PR, and CI reaches a conclusive
  merge-ready or explicit blocked state under LFG babysitting.

## Open Questions

None. The existing source-parity and random-hero contracts settle the rollover
semantics needed for this fix.

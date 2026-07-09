---
title: "fix: Restore Watch header to Lumberman baseline"
type: "fix"
status: "completed"
date: "2026-07-09"
---

# fix: Restore Watch header to Lumberman baseline

## Summary

Restore the public Watch page header/hero preview design to the Vlad-authored
state that existed on `origin/main` at `be4b1dc1` on June 20, 2026. The active
change should remove later non-Vlad header design alterations while preserving
post-baseline playback, progress, subtitle, and navigation behavior that is not
part of the header design.

---

## Problem Frame

The Watch mobile portrait header originally placed the logo, search, and
language controls on a dedicated black band above a square muted media preview.
Later work by other developers changed the header/preview composition, including
collapsing the mobile portrait wrapper to a square-only height and removing the
dedicated header band. The user wants those later header design contributions
reverted so the June 20 Lumberman design is treated as the original.

---

## Requirements

- R1. The mobile portrait Watch muted preview restores the June 20 black header
  band and square media frame contract.
- R2. Header controls remain visually on the black band before playback chrome
  is revealed.
- R3. Desktop, tablet, custom-overlay consumers, language switching, subtitles,
  playback controls, progress recording, and Watch Next behavior remain outside
  the design revert unless they directly conflict with R1 or R2.
- R4. Tests assert the restored header-band contract so the same regression
  cannot return through a future polish pass.
- R5. Browser verification captures the restored mobile portrait header on a
  representative Watch page.

---

## Key Technical Decisions

- KTD1. **Use `be4b1dc1` as the design baseline.** The user named June 20 as
  the original design boundary; `be4b1dc1` is the `origin/main` Watch commit on
  June 20, 2026, and the relevant roadmap ticket `docs/roadmap/platform/feat-175-watch-mobile-portrait-hero-preview.md`
  describes the black-band contract.
- KTD2. **Surgically restore header design, not whole files.** `HeroPlayer.tsx`
  has gained unrelated behavior since June 20, including progress, Watch Next,
  subtitle, poster, and loading changes. Reverting the whole file would discard
  non-header product work, so the implementation should reapply only the
  header-band layout and tests.
- KTD3. **Treat later non-Vlad header design assertions as regressions.** The
  current tests explicitly expect no mobile header band and `h-[100vw]`; those
  assertions should be replaced with the June 20 expectations.

---

## Assumptions

- "Lumberman" maps to the Vlad-authored Watch work in this repository.
- "As on June 20" means the state of `origin/main` at commit `be4b1dc1`, not an
  unmerged local snapshot or external design file.
- The request targets the Watch page header/hero preview surface, not the Watch
  home header or unrelated video-player chrome improvements.

---

## Implementation Units

### U1. Restore Mobile Portrait Header Band

**Goal:** Reintroduce the June 20 mobile portrait black header band and square
media frame without rolling back unrelated player behavior.

**Requirements:** R1, R2, R3

**Dependencies:** none

**Files:**

- `apps/web/src/components/watch/HeroPlayer.tsx`

**Approach:** Restore `MOBILE_PORTRAIT_PREVIEW_WRAPPER_CLASS` to the June 20
auto-height posture, restore `MOBILE_PORTRAIT_PREVIEW_BAND_CLASS`, restore the
mobile portrait `aspect-square`/`h-auto` media-frame classes, and render the
`hero-player-mobile-header-band` node only for the unrevealed default muted
preview. Keep later playback and player-state changes in place unless a class
or wrapper condition directly controls the header band.

**Patterns to follow:** `be4b1dc1:apps/web/src/components/watch/HeroPlayer.tsx`
for the header-band constants and render placement; current `HeroPlayer.tsx`
for progress, subtitle, poster, loading, and Watch Next behavior.

**Test scenarios:**

- Default muted preview renders a `hero-player-mobile-header-band` element with
  the June 20 height, black background, and portrait-only display class.
- Default muted preview keeps poster, click surface, backdrop, and loading
  layers inside the media frame, not inside the header band.
- Revealing chrome removes the mobile portrait preview classes and header-band
  node while keeping the playback frame on the existing 16:9 behavior.
- Custom overlay consumers do not receive the mobile portrait header band or
  portrait-only square media frame.

**Verification:** The rendered DOM and class assertions match the June 20
header-band contract while existing player behavior tests still pass.

### U2. Revert Header Regression Tests

**Goal:** Replace later tests that encoded the no-band design with tests that
protect the Lumberman baseline.

**Requirements:** R1, R4

**Dependencies:** U1

**Files:**

- `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`

**Approach:** Update the mobile portrait preview tests that currently expect
`h-[100vw]` and no `hero-player-mobile-header-band`. Restore the assertions for
`h-auto`, the header band, and portrait `aspect-square`/`h-auto` media frame,
while preserving new assertions for unrelated post-June player behavior where
they remain valid.

**Patterns to follow:** The June 20 test expectations in
`be4b1dc1:apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx` and the
current test helpers/mocks in the same file.

**Test scenarios:**

- The initial muted preview uses `h-auto`, not `h-[100vw]`, for the mobile
  portrait wrapper.
- The black header band exists before reveal and is absent after reveal.
- The media frame carries the portrait square sizing before reveal and drops it
  after reveal.
- Any loading-indicator expectation added after June 20 still matches the
  current player behavior when not part of the header design revert.

**Verification:** The focused HeroPlayer test file fails before U1 and passes
after U1.

### U3. Validate and Capture Browser Proof

**Goal:** Prove the restored design in code and in a browser-sized mobile
portrait viewport.

**Requirements:** R4, R5

**Dependencies:** U1, U2

**Files:**

- `apps/web/src/components/watch/HeroPlayer.tsx`
- `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`

**Approach:** Run targeted unit coverage for HeroPlayer and a focused lint or
typecheck pass for the touched Web files. Start the local Web app if needed and
capture a mobile portrait screenshot of a representative Watch URL showing the
black header band above the square muted preview.

**Patterns to follow:** The verification expectations in
`docs/roadmap/platform/feat-175-watch-mobile-portrait-hero-preview.md`.

**Test scenarios:**

- Unit tests verify the header-band and reveal contracts.
- Browser smoke at mobile portrait dimensions shows the logo/search/language
  controls on black and the media frame beginning below that band.

**Verification:** Targeted tests pass, lint/typecheck does not report touched
file errors, and browser proof is saved for PR handoff.

---

## Scope Boundaries

- Do not revert Watch home, search, progress/history, subtitle, download, or
  Watch Next behavior unless it directly altered the Watch page header design.
- Do not change public Watch URL shapes, GraphQL operations, generated files, or
  Railway production configuration.
- Do not revert Vlad-authored June 20-or-earlier Watch design work.

---

## Risks & Dependencies

- The header layout lives inside a component that has accumulated unrelated
  player behavior. The main risk is accidentally reverting functional changes
  while restoring design classes, so diffs should be reviewed against
  `be4b1dc1` and current `HEAD` side by side.
- Browser proof may need the local Web dev server and Auth/Admin environment
  already available in this worktree. If local runtime setup blocks browser
  proof, preserve the unit-test evidence and report the runtime blocker.

---

## Sources & Research

- `docs/roadmap/platform/feat-175-watch-mobile-portrait-hero-preview.md` records
  the mobile portrait header-band contract and verification target.
- `be4b1dc1` is the June 20 `origin/main` baseline for the relevant Watch files.
- Current blame identifies the mobile portrait wrapper/header-band regression in
  later non-Vlad edits to `apps/web/src/components/watch/HeroPlayer.tsx` and
  `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`.

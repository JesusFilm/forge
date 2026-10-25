---
title: 'An overlay with pointerEvents="none" cannot swallow a tap — price its overlap as visual, never functional'
date: "2026-08-27"
category: best-practices
module: apps/mobile
problem_type: best_practice
component: frontend_stimulus
severity: medium
applies_when:
  - "A layout change separates a non-interactive overlay from an interactive control"
  - "A review finding is phrased as a wide or tall element reaching a control, without naming the cost"
  - "A derived clearance constant is about to grow by the height of another row"
  - "An owner rejects a review correction after seeing it on the shipped build"
root_cause: logic_error
tags:
  - mobile
  - video-player
  - pointer-events
  - overlay
  - subtitle
  - layout
  - code-review
related_components:
  - apps/mobile/src/components/watch/PlayerControls.tsx
  - apps/mobile/src/components/watch/SubtitleOverlay.tsx
  - apps/mobile/src/components/watch/VideoPlayer.tsx
  - apps/mobile/src/components/watch/__tests__/PlayerControls.test.tsx
---

# An overlay with pointerEvents="none" cannot swallow a tap — price its overlap as visual, never functional

## Context

The mobile watch player's fullscreen caption sits a computed distance above the
player's bottom edge. Over one branch (PR #2065) that distance changed three
times:

1. The exit control moved from below the seek bar to above it. The caption
   offset was a hard-coded `92`, which silently assumed one device's
   home-indicator inset and now cleared the wrong things.
2. It was replaced with a derived helper — safe-area padding plus the seek
   bar's 44pt grab area plus the 6pt row gap.
3. A code review observed that the caption is centred and shrink-to-fit, so a
   wide cue "reaches the pill and the exit button", and raised the offset by a
   further `ICON_BUTTON_SIZE` (44pt) to clear the _entire_ bottom bar.

The owner opened the build, called the result a regression — the caption floated
away from the bar it reads against — and asked for it back down. Step 3 was
reverted.

What nobody checked between steps 2 and 4 is one line:
`apps/mobile/src/components/watch/SubtitleOverlay.tsx:239` renders the overlay
with `pointerEvents="none"`. The collision the review priced at 44pt of vertical
layout could never have cost a tap on the time pill or the exit control. It was
always, and only, a drawing overlap.

## Guidance

Before spending layout to separate an overlay from a control, decide which of
two costs is actually on the table:

- **Functional** — the overlay can receive touches, so an overlap steals input
  from the control underneath. Layout separation, or pointer-events surgery, is
  a real fix.
- **Visual** — the overlay is `pointerEvents="none"`, so an overlap is a drawing
  artifact and nothing else. It is a matter of taste, weighed against whatever
  the separation costs. Accepting the overlap is frequently correct.

Establishing which one you are looking at is a single grep at the overlay's own
source. Do it before agreeing to the layout change, not after shipping it.

The second half applies once an owner overrules a review correction: **pin the
rejected direction, not just the new value.** A guard that asserts the new
number is weaker than one asserting the old number is _not_ produced, because
the rejected version is the one a future agent re-derives from the layout — it
is the one that reads as principled.

```ts
// Weak: satisfied by any refactor that happens to keep the arithmetic.
expect(fullscreenCaptionOffset(21)).toBe(71)

// Pins the direction: goes red the moment someone re-clears the whole bar.
const ROW_ABOVE_SEEK_BAR = 44
const throughSeekBar = Math.max(21, 8) + 44 + 6
expect(fullscreenCaptionOffset(21)).toBe(throughSeekBar)
expect(fullscreenCaptionOffset(21)).toBeLessThan(
  throughSeekBar + ROW_ABOVE_SEEK_BAR,
)
```

## Why This Matters

**A derived number feels objective, and that is the trap.** The helper was
derived from real constants — `SCRUBBER_HIT_HEIGHT` (`Scrubber.tsx:48`),
`TIME_ROW_GAP` and `ICON_BUTTON_SIZE` (`PlayerControls.tsx:87`, `:90`) — rather
than eyeballed, which is why the review's addition read as principled and went
in unchallenged. Derivation authenticates the arithmetic. It says nothing about
whether the element being cleared needed clearing, and a wrong premise expressed
as a sum of named constants is harder to question than the same premise written
as `92`.

**The cost was asymmetric in the direction nobody measured.** The overlap the
clearance bought off affects wide cues, occasionally. The clearance itself
affected every caption, always. A guard against a rare cosmetic event was paid
for with a permanent position change — and the permanent side is what the owner
saw first.

**This is the mirror of a law the repo already holds.**
`docs/solutions/logic-errors/occluding-layers-must-share-one-gate-predicate.md`
records the opposite mistake in the same player: `pointerEvents="none"` offered
in a code comment as evidence that a _covering_ layer was safe, when reachable
is not visible. Its rule — "It is evidence about hit testing and nothing else" —
cuts in both directions:

| Direction                    | Mistake                                                            | Where recorded           |
| ---------------------------- | ------------------------------------------------------------------ | ------------------------ |
| Used where it does not apply | "The layer passes touches through, so hiding the controls is fine" | the occluding-layers doc |
| Ignored where it does apply  | "A wide cue reaches the exit button, so buy 44pt of clearance"     | this doc                 |

Both failures come from not asking the attribute the one question it answers.

## When to Apply

- Any layout change that separates an overlay from an interactive control.
- Any review finding of the shape "a wide or tall X could reach Y" — ask whether
  reaching Y costs anything before pricing it.
- Whenever a clearance constant is about to grow by the height of a whole row.
- Whenever an owner rejects a review correction on the shipped build: capture
  the direction, because the rejected version is the tempting re-derivation.

## Examples

Before — clears the entire bar, including a row it cannot take input from:

```ts
export function fullscreenCaptionOffset(bottomInset: number): number {
  return (
    Math.max(bottomInset, 8) +
    SCRUBBER_HIT_HEIGHT +
    TIME_ROW_GAP +
    ICON_BUTTON_SIZE // the pill/exit row — never reachable by the caption
  )
}
```

After — clears the seek bar it must not sit on, and stops:

```ts
export function fullscreenCaptionOffset(bottomInset: number): number {
  return Math.max(bottomInset, 8) + SCRUBBER_HIT_HEIGHT + TIME_ROW_GAP
}
```

The seek bar's 44pt grab area stays in the sum for a different reason, and one
worth keeping straight: the caption sitting _visually_ on the moving thumb is
the artifact being avoided there, not a stolen touch — the overlay could not
steal one. Clearing a grab area is a legitimate visual choice; it just is not a
functional one.

## Related

- `docs/solutions/logic-errors/occluding-layers-must-share-one-gate-predicate.md`
  — the same attribute, the opposite wrong inference, same player surface.
- `docs/solutions/design-patterns/watch-language-player-chrome-layout-20260609.md`
  — the `apps/web` sibling of this chrome and its subtitle overlay.
- `docs/solutions/workflow-issues/ce-code-review-tier-2-mandatory-before-push-20260511.md`
  — the review tier that produced the finding; this doc is a note on adjudicating
  its output, not an argument against running it.
- PR #2065 (`apps/mobile` watch player polish) — open and unmerged as of
  2026-08-27; carries all three offset revisions in sequence.

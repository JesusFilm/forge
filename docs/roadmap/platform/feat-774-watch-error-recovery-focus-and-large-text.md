---
id: "feat-774"
title: "Keep focus and the message visible when a Watch error recovers or shows at large text"
owner: "unassigned"
priority: "P2"
status: "complete"
start_date: "2026-10-20"
duration: 2
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "accessibility"
---

## Problem

The 2026-10-20 overnight audit found two gaps in Watch error states. Both
are left after PR #2838 (feat-772), which gave route errors one `<main>`,
`role="alert"` and readable text.

1. **Retry focus.** On a route error boundary, pressing "Try again" calls
   `reset()`. The button is removed and the recovered page renders, but
   focus falls to `<body>`. A keyboard or screen-reader user loses their
   place. This was seen in round 08 and round 10 fixtures that rendered the
   real boundaries.
2. **Inline error at 200% text.** On `/watch` without Admin data, the
   centered inline `ExperienceError` outgrows its `40vh` box at 200% root
   font size. Its first line sits under the fixed header at 320 and 390 px.
   The inline message still reads "Failed to load experience: …". This is
   pre-existing and the same on main. Evidence:
   `round-10/browser/header/_watch-320-200.png` in the audit user data.

Report: `docs/reports/2026-10-20-watch-overnight-audit.md`.

## Entry Points — Read These First

1. `apps/web/src/components/ExperienceError.tsx`: the shared error view,
   its centered `40vh` box and the inline copy.
2. `apps/web/src/app/[locale]/[htmlLang]/error.tsx` and
   `apps/web/src/app/[locale]/[htmlLang]/[...rest]/error.tsx`: the route
   boundaries that call `reset()`.
3. PR #2637: the `#watch-main-content` skip target
   (`watchMainContentTargetProps`). It is the natural focus target after a
   recovery.

## Grep These

- `ExperienceError`, `reset()`, `pageLoadFailed`
- `watchMainContentTargetProps`, `watch-main-content`
- `min-h-[40vh]`

## What To Build

- After a successful `reset()`, move focus once to the main content
  target (`tabIndex={-1}`, no visible page-sized ring). Do it only when
  focus was inside the error view, so nothing is stolen from a user who
  has moved on. If the boundary fails again, focus stays on the new error
  view's button.
- Let the inline error box grow with its content (`min-h` rather than a
  fixed height, plus header clearance in `rem`), so the message starts
  below the header at 200% text.
- Use the existing translated `pageLoadFailed` sentence for the inline
  copy, as #2838 does for route boundaries. Do not add new strings.

## Constraints

- Land after #2637 and #2838, or rebase onto them. Both edit `error.tsx`.
- Do not add global navigation focus handling. This fix is for the error
  recovery path only.
- Do not change error logging, retry semantics or the loading shells.

## Verification

- A unit test where `reset()` recovers: focus ends on the main target.
  Falsify it once by removing the focus call.
- Browser check in a real-boundary fixture: Tab to "Try again", press
  Enter, then `document.activeElement` is the main target, not `BODY`.
- At 320x640 and 390x844 with 200% root font size, the error message's
  top is below the header's bottom, and there is no horizontal scroll.

## October 29 preparation

PR #2849 implements the retry/large-text behavior and now clears retry intent
when the same mounted boundary receives a new error. Temporary main tabindex
and outline changes are removed on blur without changing pre-existing values.
The added behavior tests fail four cases on the prior code and all 16 boundary
tests pass after the repair. Scoped ESLint passes. This PR remains stacked on
#2838; route-group integration, current production loading checks and exact-head
CI are separate release gates. The code is prepared, not merged or deployed.

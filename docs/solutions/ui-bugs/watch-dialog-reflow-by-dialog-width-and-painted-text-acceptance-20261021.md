---
title: "Reflow a Watch dialog by its own width, and accept it on painted text"
date: 2026-10-21
problem_type: ui_bug
module: apps/web
component: watch_download_dialogs
severity: medium
tags:
  - watch
  - dialog
  - container-query
  - large-text
  - responsive
  - browser-verification
  - playwright
applies_when:
  - "A dialog or card is narrower than the viewport and a Tailwind `sm:`/`md:` rule still decides its columns"
  - "Padding or gaps use rem or viewport units inside a box that is sized by something else"
  - "Reviewing a layout fix whose only evidence is class-string unit tests"
  - "Writing a browser spec that reads live Admin content"
---

# Reflow a Watch dialog by its own width, and accept it on painted text

## Problem

The collection download dialog (PR 2836, feat-457) is `min(960px, 100vw - 10rem)`
wide from `sm` up, so the fixed close button never covers it. At 200% text the
dialog is far narrower than the viewport. The Language and Video quality fields
still split into two columns at the viewport `sm` breakpoint. At 768x480 with a
32px root font each select was 132px wide. The selected language showed 14px of
text over seven lines, and its popup had no room to open.

## What did not work

Class tests. 971 unit tests passed, because jsdom has no layout and a class test
only repeats the source. The defect was visible only in a real browser.

## Fix

- Decide columns by the width of the dialog. Use a container query on the
  existing `@container` content box (`@min-[36rem]:grid-cols-2`), not `sm:`.
  Choose the threshold by measurement: at `32rem` the longest real label,
  "Arabic, Modern Standard", was still cut by an ellipsis.
- Size padding and gaps by the box they sit in (`cqi`), or cap a rem padding
  with a viewport cap (`min(2.25rem,5vw)`), so a narrow dialog keeps its width
  for the value.
- Let the value wrap. Do not truncate it.

## Accept it on painted text

Check the text that the browser paints, not the classes. The spec
`apps/web/e2e/watch-collection-download-fields.spec.ts` does this for each
viewport and root font size:

- It reads the `Range` client rects of the selected text and compares them with
  each ancestor that hides overflow, from the text up to its select button. It also checks `text-overflow: ellipsis`
  against `scrollWidth`, and finds words that split across lines.
- It selects the long option labels with real pointer clicks. A click fails when
  another element receives it, so a popup with no room fails the test.
- It was run against the previous build as a negative control. All four
  representative cases failed there (clipped text, ellipsis, an invisible
  search field, an option outside the viewport). Run a negative control for
  every new layout spec. A spec that never failed has not shown that it can.

The clipped-ink number is horizontal box geometry. It does not prove vertical
paint or raster ink. A root font size of 32px approximates 200% text, but media
queries still read 16px, so it is not browser zoom.

## Spec reliability

The spec is a MANUAL check. It skips unless `WATCH_COLLECTION_DOWNLOAD_TEST_LIVE=1`
and `WATCH_COLLECTION_DOWNLOAD_TEST_BASE_URL` are set, and it always skips when
`CI` is set. There is no default address. No GitHub workflow runs the web
Playwright suite at this time, so the guard only stops the default
`playwright test` discovery from picking up a live-content case.

- The hero Download button is server-rendered. In some runs the first Enter did
  not open the dialog. In a probe of 20 loads at 736x480, 8 buttons had no React
  props at the `load` event, yet Enter still opened the dialog in all 20. The
  mechanism is not proven; a hydration race is only a hypothesis. The spec
  presses Enter again until the dialog is open. The 15 s value is an outer retry
  budget, not a hard limit on each locator action.
- The quality tiers come from a server action that reads production Admin. In
  some runs the lookup failed. The spec waits for usable options after EACH
  language selection, before it measures that language. It presses the dialog's
  "try again" control once for each lookup and records the press as a test
  annotation. A second failure ends the test with a neutral message. The cause is
  unknown, because the server action hides the error. The retry extends the
  whole remaining test timeout only when it runs.
- One full run against production content made 322 failed lookups, and a
  second full run that started at once failed 16 of 18 cases. A rate limit at
  Admin is suspected. It is not confirmed. The observation does not give a safe
  run cadence.
- Do not repeat the full 18-case matrix against production content as a
  readiness gate. Run only the cases that you need with `--grep`.
- Before this spec joins routine or CI runs, add a deterministic local Admin
  fixture or mock. Keep the real component, geometry and click assertions when
  you add it.
- Evidence limits: earlier spec revisions passed full 18-case runs. The final
  committed revision had the 4 representative cases run (4 of 4 on the fixed
  build, 4 of 4 failures on the previous build) before the opt-in guard and the
  per-language wait were added. Those two changes were checked only offline.

## Related

- `docs/roadmap/platform/feat-457-watch-modal-page-scroll.md`
- `docs/roadmap/platform/feat-782-watch-download-dialog-text-and-popup-residuals.md`
- `docs/solutions/ui-bugs/watch-floating-header-trailing-column-overflow-20260826.md`
- `docs/solutions/ui-bugs/watch-download-modal-safeguards-can-regress-independently.md`

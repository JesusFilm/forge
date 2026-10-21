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
  every ancestor that hides overflow. It also checks `text-overflow: ellipsis`
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

- The hero Download button is server-rendered. An Enter key before hydration can
  be lost and no dialog opens. In a probe of 20 loads at 736x480, 8 buttons had
  no React props at the `load` event, yet Enter still opened the dialog in all
  20, so the loss is rare and the mechanism is not proven. Press again until the
  dialog is open, with a bounded budget. Keep the retry on the opening step only.
- The quality tiers come from a server action that reads production Admin. That
  lookup fails now and then. Press the dialog's own "try again" control once,
  record the press as a test annotation, and fail with an upstream message if it
  fails twice. More retries add load to a service that is already failing.
- Do not run the full matrix twice in a row against production content. Each
  case makes three lookups, so one run makes about 54. After a rest of about ten
  minutes, a first run passed 18 of 18, and a second run that started at once
  failed 16 of 18 on the lookup, even after the one retry. Ten minutes later one
  lookup succeeded again. The cause is probably a limit on the Admin side. It
  was not confirmed, because the web server hides the error text. Wait about ten
  minutes between full runs, run a short sample, or replace the lookup with a
  fixture in a follow-up.

## Related

- `docs/roadmap/platform/feat-457-watch-modal-page-scroll.md`
- `docs/roadmap/platform/feat-782-watch-download-dialog-text-and-popup-residuals.md`
- `docs/solutions/ui-bugs/watch-floating-header-trailing-column-overflow-20260826.md`
- `docs/solutions/ui-bugs/watch-download-modal-safeguards-can-regress-independently.md`

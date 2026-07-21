---
title: "Window scrolls past the chat composer — sr-only absolute spans escape the unpositioned scroll container and extend document overflow"
date: "2026-07-21"
category: ui-bugs
module: apps/chat
problem_type: ui_bug
component: chat-composer
symptoms:
  - "After scrolling a sourced Seeker chat to the bottom, the window keeps scrolling — the entire app including the sticky composer band slides up out of view leaving dead space below"
  - "document.scrollingElement.scrollHeight exceeds window.innerHeight (e.g. 2039 vs 775) while the inner [data-chat-scroller] element shows no overflow of its own"
  - "Only chats with a rendered and expanded 'Sources · N' disclosure reproduce; stub chats and RAG-failed turns (no links) are unaffected"
  - "Reproduces identically in Chrome, Safari, and incognito — engine-independent layout behavior, not an extension or cache artifact"
  - "496/496 jsdom vitest suite stays green — jsdom performs no layout, so absolute-position scrollable-overflow contribution is structurally invisible to it"
root_cause: logic_error
resolution_type: code_fix
severity: medium
related_components:
  - "apps/chat/src/components/chat/chat.tsx"
  - "apps/chat/src/components/chat/untrusted-link.tsx"
tags:
  - "sr-only"
  - "position-absolute"
  - "containing-block"
  - "scrollable-overflow"
  - "scroll-chaining"
  - "chat-scroller"
  - "tailwind"
  - "jsdom-limits"
---

# Unpositioned scroll container let sr-only abspos boxes escape and extend the page scroll below the app (scroll-past-the-composer)

**The general law:** any scroll container whose content includes absolutely positioned descendants that belong to the scrolled content — and whose nearest positioned ancestor would otherwise lie OUTSIDE the scroller — must itself be positioned (`position: relative` is enough). An abspos element's containing block is the nearest POSITIONED ancestor — if the scroller is not positioned, those boxes anchor past it to an outer ancestor, sit at fixed UNSCROLLED depths in that ancestor's coordinate space (they do not scroll with the content they visually belong to), and — since every ancestor up to `<body>` is `overflow: visible` — extend the PAGE's scrollable overflow below the app. `sr-only` spans are the sneaky case: Tailwind's `.sr-only` is `position: absolute` + 1px + `clip-path: inset(50%)` — visually invisible, but layout-real, and they participate in containing-block resolution and scrollable overflow like any abspos box.

## Problem

apps/chat "scroll past the composer": at the bottom of a Seeker chat with cited sources, further scrolling slid the whole app — sticky composer included — up out of the window, leaving a viewport-plus of dead space below. Chrome, Safari, and incognito all reproduced (engine-independent). ONLY chats with rendered source links were affected; stub chats and RAG-failed turns (no links) were fine. The trigger elements were the `(opens in a new tab)` sr-only spans inside every source link (`apps/chat/src/components/chat/untrusted-link.tsx:33`), whose containing block was not the scroller (`data-chat-scroller`, `apps/chat/src/components/chat/chat.tsx:216-219`) but the chat pane's `relative` root (`chat.tsx:208`).

## Symptoms

- The window itself scrolls past the `h-dvh` app shell: `document.scrollingElement.scrollHeight` (1259, later 2039 in the controlled repro) exceeds `innerHeight` (827 / 775), with `scrollY` up to 432 — while the inner `[data-chat-scroller]`'s geometry is exactly clean (`contentBottom == scrollHeight`, phantom space 0px).
- The composer becomes unreachable at the true bottom — the page's extra scroll range is dead space below the app.
- Screenshots show transcript + composer moving as a RIGID unit (constant gap between them) — the tell that the _document_ scrolled, not the inner scroller. If the inner scroller were at fault, the transcript would move relative to the composer band.
- Only conversations with rendered sources reproduce; expanding the "Sources · N" disclosure at the bottom of a long transcript is the trigger (see Why This Works).
- Engine-independent (Chrome + Safari): spec-level layout behavior, not a browser quirk.

## What Didn't Work

- **An exhaustive headless-Chromium interaction matrix against BOTH local dev and production.** Streaming token pin, the feat-269 finalize scroll (`chat.tsx:152-170`), stop mid-stream, sources expand/collapse at the bottom, snippet collapse (the scroll-anchoring case), composer draft grow/shrink (the feat-270 ResizeObserver re-pin, `chat.tsx:175-198`), conversation switch, mobile drawer open/close, forced overscroll (`scrollTop = 999999`) — the inner scroller's phantom space measured 0–1px in every state. The matrix was blind by construction: the probes recorded `document.scrollHeight` only in states where the Sources `<details>` (`apps/chat/src/components/chat/sources-list.tsx:78-82`, collapsed by default per feat-269) was CLOSED — and a closed `<details>` does not lay out its content, so the source links and their sr-only spans did not exist in layout during exactly the probes that checked the document.
- **A browser-engine hypothesis.** Suspected WebKit's known sticky-position scrollable-overflow divergence (the composer band is `sticky bottom-0` INSIDE the scroller, `chat.tsx:250-253`); nearly installed Playwright WebKit (~279 apt packages) before the user reported the bug also reproduced in Chrome — engine-independent, therefore a spec-level layout property, not an engine quirk.
- **Sidebar-overflow and body-height theories** — `h-dvh` sizing, `dvh` keyboard behavior, devtools device-mode canvas panning. All eliminated by measurement.

The breakthrough was a one-line console probe run IN the bug state: inner scroller clean (`scrollTop` 700.5 / `scrollHeight` 1527 / `clientHeight` 827; `contentBottom` 1527) but `document.scrollHeight` 1259 vs `innerHeight` 827 with `scrollY` 432 — the DOCUMENT had grown. The user's "only chats with sources" observation plus a grep for `absolute|sr-only` over the transcript DOM narrowed it to the one absolutely positioned element unique to sourced turns: the sr-only span in `UntrustedLink`. Arithmetic locked it: content 1527px tall, last source link ~268px above the content end → its unscrolled depth ~1259 == `document.scrollHeight` exactly.

## Solution

Add `relative` to the scroller's className, making the scroll container the containing block for its own content's abspos boxes. Current tree, `apps/chat/src/components/chat/chat.tsx:216-219` (with the load-bearing comment at `chat.tsx:209-215`):

```tsx
// BEFORE — scroller unpositioned; abspos descendants anchor past it
<div
  ref={logRef}
  data-chat-scroller
  className="min-h-0 flex-1 overflow-y-auto [scroll-padding-bottom:13rem]"
>
```

```tsx
// AFTER — chat.tsx:216-219
<div
  ref={logRef}
  data-chat-scroller
  className="relative min-h-0 flex-1 overflow-y-auto [scroll-padding-bottom:13rem]"
>
```

Verified in-browser post-fix: document height stays exactly viewport-sized with the Sources disclosure AND all passage snippets expanded on a 2379px transcript; a forced `window.scrollTo` does nothing. All three laws of the adjacent sticky-overlay doc re-verified on the same component: the band sticks at the viewport bottom when scrolled up; the opaque-strip hit-test resolves to the `pointer-events-auto` wrapper (`chat.tsx:255`); a focus probe parks a deep link above the band with zero document movement; the feat-270 ResizeObserver re-pin still fires. 496/496 vitest, lint + typecheck clean. Shipped via [PR #1633](https://github.com/JesusFilm/forge/pull/1633).

## Why This Works

- **Containing-block resolution is the root cause.** Tailwind's `.sr-only` is `position: absolute` (plus 1px box + `clip-path`). An abspos box's containing block is the nearest positioned ancestor — and the scroller div was not positioned, so the spans anchored past it to the chat pane's `relative` root (`chat.tsx:208`). Their static-position boxes therefore sat at fixed, unscrolled depths in the PANE's coordinate space: laid out where the link happened to be at layout time, but never moving when the transcript scrolled.
- **Escaped boxes extend the page's scrollable overflow.** Every ancestor from the pane root up to `<body>` is `overflow: visible`, so the deepest span's box extended the document's scroll area by (deepest link's unscrolled depth − viewport height) whenever the transcript outgrew the viewport. Repro measurement: expanding the Sources disclosure took `document.scrollHeight` from 775 (== viewport, correct) to 2039, and the three deepest boxes in document coordinates were exactly the three sr-only spans (bottoms 2039 / 1925 / 1811). Pure CSS-spec behavior → engine-independent, which is why the WebKit hypothesis was a dead end.
- **`relative` on the scroller re-homes the boxes.** With the scroll container positioned, it becomes the containing block for its content's abspos descendants: the sr-only spans now live in the scroller's coordinate space, scroll with the links they annotate (also the correct screen-reader geometry), and are clipped by the scroller's `overflow-y-auto` — they can no longer contribute to the page's scrollable overflow.
- **No paint-order side effects.** `position: relative` with `z-index: auto` creates no stacking context, so the pane's existing layering (sticky band, gradient, transcript) is unchanged.

## Prevention

- **Apply the law by default:** any scroll container whose content can include absolutely positioned descendants gets `relative` (or another positioning) on the scroller itself. sr-only spans count — `sr-only` is not layout-inert; it is an abspos box like any other and participates in containing-block resolution and scrollable overflow. Exception: do NOT apply this to a scroller whose abspos descendants deliberately anchor to an outer ancestor to escape scroller clipping (non-portal popovers/dropdowns, pane-covering `inset-0` overlays) — positioning the scroller re-homes and clips them; portal such content to the body instead.
- **Diagnostic recipe when "can scroll past the app" is reported.** FIRST compare `document.scrollingElement.scrollHeight` to `innerHeight` — that one comparison splits page-level phantom space from inner-scroller phantom space and would have skipped the entire inner-scroller interaction matrix. Then enumerate the deepest boxes and let the culprit name itself:

  ```js
  ;[...document.querySelectorAll("body *")]
    .map((e) => [e.getBoundingClientRect().bottom + scrollY, e])
    .sort((a, b) => b[0] - a[0])
    .slice(0, 5)
  ```

  (`body *`, not `main *` — portal-rendered overlays attach to `document.body` outside the app's `<main>` and are a common alternative cause of the same symptom.)

- **The rigid-unit screenshot heuristic:** if the transcript and the sticky composer move together with a constant gap, the document scrolled — stop probing the inner scroller.
- **Probe geometry with disclosures EXPANDED.** A closed `<details>` hides its content from layout entirely, so geometry probes on collapsed states prove nothing about the expanded state. Any probe matrix over a component with `<details>` (or other display-toggling disclosure) must include the open state of each.
- **This bug class is browser-verification-only.** jsdom has no layout — containing blocks, scrollable overflow, and static abspos positions are all structurally invisible to it; the full green vitest suite says nothing here. Consistent with the repo's mocked-shape-vs-real-contract discipline (`docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`).

## Related Issues

- `docs/solutions/ui-bugs/sticky-overlay-scroll-container-pointer-events-scroll-padding.md` — the adjacent "three laws" doc for this same component (scoped click-through, scroll-padding, pre-resize re-pin basis). This doc adds the fourth: position the scroller so abspos content can't escape it. All three prior laws re-verified after this fix.
- `apps/chat/src/components/chat/untrusted-link.tsx:33` — the sr-only `(opens in a new tab)` span (feat-268's shared hardened anchor); the span is correct and stays — the scroller was the bug.
- `apps/chat/src/components/chat/sources-list.tsx:78-82` — the collapsed-by-default Sources disclosure (feat-269) whose closed state hid the spans from every document-height probe.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — the META pattern: green unit suites prove code shape, not browser contract; here even the browser matrix was blind until it probed the expanded-disclosure state.

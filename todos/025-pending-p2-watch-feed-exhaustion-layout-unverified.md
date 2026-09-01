---
status: pending
priority: p2
issue_id: "025"
title: Collapsing the watch feed sentinel at exhaustion is unverified in a browser, and shrinks the page under a reader who is already at the bottom
labels:
  - web
  - watch
  - infinite-feed
  - layout-shift
  - verification-gap
created_at: 2026-08-31
---

# Problem

`apps/web/src/components/sections/DynamicMediaCollection.tsx` now drops the feed
sentinel's `min-h-28 py-8` (>=176px) the moment paging is exhausted, so the
end-of-library band no longer sits under the last rail:

```tsx
const feedExhausted = status !== "error" && !hasNextPage
```

Two things about that moment are unverified.

**1. The page shrinks under a reader who is already at the bottom.** On the
zero-append exhaust paths — a final page of all duplicates, or a cursor that
stops advancing (`MAX_DUPLICATE_ONLY_PAGES_PER_ATTEMPT`) — nothing is appended
while the band disappears. A reader sitting at the end of the feed has the
document get shorter under them, so the browser clamps scroll position and the
view jolts. On the ordinary append-and-exhaust path the new rails grow the page
far more than 176px and mask it, which is why this is easy to miss.

**2. It is also a layout-shift (CLS) contributor.** The collapse is triggered by
a network response, not by user input, so it is not input-excluded. Everything
below the sentinel — `WatchHomeFooter` — moves up. Initial page load is
unaffected: `hasNextPage` starts `true`, so the first render keeps the old
classes and the old paragraph styling. The risk lives entirely in the
exhaustion window, which is the window that was never measured.

# Why the existing tests do not cover it

`DynamicMediaCollection.test.tsx` runs in jsdom, which performs no layout. Every
assertion about the collapse reads the class list, because `scrollHeight`,
`getBoundingClientRect`, and containing-block resolution are all structurally
invisible there. A green suite says nothing about any of the above — consistent
with `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`.

The retained message is also `sr-only`, which Tailwind implements as
`position: absolute`. Per
`docs/solutions/ui-bugs/sr-only-absolute-overflow-escapes-unpositioned-scroll-container.md`
that box is layout-real and participates in page scrollable overflow, and it now
sits inside a zero-height container it did not before. The risk is low (the
Watch page scrolls at document level and the footer follows the feed), but it is
the same class of thing jsdom cannot see.

# What to do

Run the browser smoke the originating plan specified but that could not run on
the authoring machine — no admin backend was reachable, so the exhausted feed
state was unreachable in a browser:

- `pnpm --filter @forge/web build` then `pnpm --filter @forge/web start`, scroll
  `/watch` to the end of the collection feed against a populated admin.
- Record CLS across the exhaustion window specifically, not initial load.
- Reproduce the zero-append exhaust path and check whether the scroll position
  visibly jolts. If it does, decide between keeping a small reserved height and
  accepting the jolt — that is a product call, not a mechanical fix. Note that
  the user directed that nothing be *shown* there, so any mitigation must not
  reintroduce visible content.
- Take the page-overflow reading the plan defines: at the exhausted state, fail
  if `document.scrollingElement.scrollHeight` exceeds the greater of the last
  visible rail's document-coordinate bottom and the viewport height by more than
  one CSS pixel.
- Confirm with a screen reader that the end-of-library sentence is announced
  once while staying visually hidden. The unit assertions check the final DOM's
  content and class, which a live region that never mutated would also satisfy.

This also closes the root `CLAUDE.md` requirement that a frontend change carry
page-load/rendering performance evidence; that gate was not satisfied for this
change.

# Source

[PR #2126](https://github.com/JesusFilm/forge/pull/2126) on branch
`t3code/hide-infinite-end-section`.
Plan: `docs/plans/2026-08-31-2042-fix-watch-feed-end-notice-removal-plan.md`.

Severity: P2. Reviewers: correctness/frontend-races (in-process), corroborated by
the cross-model adversarial pass (GPT-5.6-sol), which independently reported the
same unmeasured window as a residual risk and testing gap.

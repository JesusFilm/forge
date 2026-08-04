---
id: "feat-334"
title: "Chat render-boundary + clamp-guard consolidation"
owner: "jian wei"
priority: "P2"
status: "not-started"
start_date: "2026-08-14"
duration: 2
depends_on:
  - "feat-328"
blocks: []
tags:
  - "web"
  - "testing"
  - "error-handling"
---

## Problem

feat-328 shipped a second per-message error boundary and a second copy of a
load-bearing test denylist, moved two prop derivations to a position the
boundary above them cannot protect, left the session-scoped chunk-load failure
with no user-facing recovery, and left two of its own new tests slightly short
of the discipline the same PR codified. None of the six is a defect today; all
six were raised in review and deliberately deferred so the arc's checkpoint
file map stayed stable. This ticket bundles them because they share one
question: where does the render-containment seam actually sit, and what is
allowed to live on each side of it?

Each item has a legitimate "leave it as it is" outcome. Recording WHY is a
complete resolution — this is not a mandate to refactor.

## Entry Points — Read These First

1. `apps/chat/src/components/chat/video-card.tsx` — `VideoRenderBoundary`
   (render-callback `children`, `fail` for async playback errors), plus the
   `posterUrl()` / `boundedLabel()` calls inside that callback.
2. `apps/chat/src/components/chat/assistant-markdown.tsx` —
   `MarkdownRenderBoundary` (feat-268), the original of the pattern. Note its
   fallback renders `content`; the video one renders a fixed line.
3. `apps/chat/src/components/chat/video-card.test.tsx` — the 13-name display
   denylist in "clamps the caption visually…".
4. `apps/chat/src/components/chat/sources-list.test.tsx` — the SAME 13-name
   denylist, and the comment recording that the unclamp was browser-caught in
   feat-269. This copy is the source of truth.
5. `apps/chat/CLAUDE.md` — the "Featured video (feat-328)" section states the
   containment scope items (c) and (d) are about.

## Grep These

- `getDerivedStateFromError` — both boundary classes
- `line-clamp-` — every clamped surface in chat
- `displayUtilities` — the duplicated denylist, both copies
- `VideoRenderBoundary>` — the render-callback call site

## What To Build

Six independent items. Any may be resolved as "keep as-is, reason recorded".

**(a) Shared render boundary, or a recorded decision not to share.**
`VideoRenderBoundary` and `MarkdownRenderBoundary` were near-identical when
review first flagged the duplication. They are no longer: feat-328 changed
`children` to a render callback `(fail: () => void) => ReactNode` so an async
media `error` event could reach the same fallback. A shared
`RenderErrorBoundary` would need to serve both shapes:

```ts
type RenderErrorBoundaryProps = {
  fallback: ReactNode | ((retry: () => void) => ReactNode)
  children: ReactNode | ((fail: () => void) => ReactNode)
}
```

Decide whether that generality is worth one class, or whether two small,
honest classes are the better answer. "Keep both" is a legitimate outcome —
record it in `apps/chat/CLAUDE.md` beside the boundary description so the
duplication reads as chosen rather than accidental.

**(b) Extract the display-utility denylist.**
The 13-name list guards a real incident (feat-269: a display utility beside
`line-clamp-*` silently unclamps it, and jsdom performs no layout, so the class
mix is the only in-CI guard). It now exists twice, hand-maintained. Extract one
constant consumed by both suites, e.g.
`apps/chat/src/components/chat/display-utility-denylist.ts`, and have
`video-card.test.tsx` and `sources-list.test.tsx` import it. Keep the feat-269
provenance comment on the constant, not on the call sites.

**(c) Recovery affordance for the session-scoped failure, or a recorded accept.**
A chunk-load failure degrades EVERY video turn for the session and is not
retryable at the import layer (see the 2026-08-04 correction in the plan's U3).
Recovery is a page reload, and today nothing tells the user that — the fallback
line reads the same as a single-turn playback failure. Either distinguish a
`ChunkLoadError`-shaped rejection from a render throw and offer a reload only
for that class, or record "no user-facing recovery for the session-wide class;
accepted" in `apps/chat/CLAUDE.md` beside the containment bullet.

**(d) Guideline: hoist prop derivations ABOVE the boundary.**
`VideoRenderBoundary` cannot catch throws from its own `render()`, and the
render-callback design evaluates `posterUrl()` and `boundedLabel()` exactly
there. `formatDuration()` and the `UntrustedLink` caption already sit above it.
All are throw-free today and the code comments show awareness, but nothing pins
that property, and the containment claim's real scope is "the player subtree
only". Either hoist the two derivations above the boundary so the invariant is
structural, or add the guideline to `apps/chat/CLAUDE.md` as a rule future
label/poster logic must follow (an `Intl.Segmenter` call or a locale lookup
added inside that callback would escape containment silently).

**(e) Cover the `shape` branch in the per-branch leak test.**
`apps/chat/src/lib/chat-stub.test.ts`'s "never emits a wire VALUE — checked at
EVERY branch independently" builds one poisoned payload per rejection branch,
but its `perBranch` list omits `shape`. That branch is reached with a
non-object payload, so it has no field to poison in the same shape as the
others — which is why it was skipped, and why a future refactor that logged
`String(value)` on the shape rejection would slip through the one test written
to catch exactly that. Add a row with a marker-bearing non-object payload (e.g.
a string containing the marker), asserting the emitted line carries the token
and not the marker.

**(f) Bring the closed-vocabulary pin up to the source-pin recipe.**
The same file's "keeps the reason vocabulary CLOSED and fully covered" test
strips only block comments before counting `rejectVideo(` call sites. That is
lighter than rule 2 of the source-pin recipe THIS PR codified in
`docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
(strip block, whole-line AND trailing `//`). A commented-out call site would
currently still be counted. The invariant is covered behaviorally today by the
per-branch exact-line tests, so this is consistency-with-our-own-rule rather
than an open hole — but the recipe should not be violated by the PR that wrote
it. Reuse the widened strip from `video-card.test.tsx` (which guards the `://`
in a URL literal).

## Constraints

- Items (a), (b), (d), (e) and (f) are behavior-preserving — no user-visible
  change; (e) and (f) are test-only. Item (c) is the exception: adding a reload
  affordance IS user-visible, and that is the point; only the "recorded accept"
  resolution changes nothing.
- Do NOT weaken the two containment behaviors feat-328 established: a render
  throw and an async playback `error` must both land on the same per-message
  fallback, with the caption link still reachable.
- Do NOT reintroduce chunk-load retry prose. That failure is session-scoped and
  not mitigatable at the import layer on a Turbopack build — see the
  2026-08-04 correction in
  `docs/plans/2026-08-02-001-feat-seeker-video-featuring-plan.md` (U3).
- If (b) is done, the extracted constant must stay test-only — do not let a
  component import it.

## Verification

- `pnpm --filter @forge/chat test` + `typecheck` + `lint` green.
- Falsify (b) once: add `block` beside `line-clamp-2` in `video-card.tsx` and
  again in `sources-list.tsx`; each must turn its own suite red from the
  shared constant. Restore from a file copy and verify sha256 — never
  `git checkout` on an uncommitted tree.
- If (a) extracts a shared class: both boundary suites pass unchanged, and the
  video card still shows its fallback for BOTH a render throw and an
  `onError` call.
- If any item is resolved as "keep as-is": the reason is written into
  `apps/chat/CLAUDE.md`, and this ticket's Resolution names which items were
  changed and which were deliberately not.

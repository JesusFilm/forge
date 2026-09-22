---
title: "Deferring one call site does not split a chunk — the bundler needs every importer"
date: "2026-09-22"
category: "performance-issues"
module: "apps/web"
problem_type: "incorrect_assumption"
component: "code-splitting"
resolution_type: "code_fix"
severity: "high"
root_cause: "incorrect_assumption"
tags:
  - "code-splitting"
  - "next-dynamic"
  - "turbopack"
  - "bundle-size"
  - "watch"
  - "media"
  - "performance"
  - "error-boundary"
  - "invariant-test"
applies_when:
  - "Moving a heavy dependency off a route's initial bundle with next/dynamic"
  - "A ticket names one call site as the reason a chunk is on the critical path"
  - "Gating a lazily-mounted media surface behind a document-load or interaction gate"
  - "Writing a source-level invariant test to stand in for a build-graph fact"
---

# Deferring one call site does not split a chunk — the bundler needs every importer

## Context

Linear FGE-138 / feat-535. hls.js + mux-embed rode along with
`@mux/mux-video-react` as one 646,759 B chunk that Turbopack placed in
`firstLoadChunkPaths` for **both** Watch routes, served as a plain
`<script src>` in the initial document — about a fifth of the page's JS on a
listing page that needs no video engine until a hero plays.

The audit ticket named one file: the home hero carousel's static import. That
was the obvious cause, and it was wrong.

## Guidance

### 1. Module-level deferral is all-or-nothing. Measure, don't reason.

Converting the named call site to `next/dynamic(..., { ssr: false })` changed
the first-load byte count by ~0%. A probe build that deleted that import
**entirely** also changed nothing. Three sibling importers remained
(`components/sections/{Video,VideoHero,CarouselVideo}.tsx`), and while each of
_those_ components is itself reached through a `next/dynamic` table, their own
static import of the player kept the engine in a chunk the route's client entry
loads regardless. Only a probe that deferred **all four** moved it — then both
routes dropped ~646 KB at once.

A fifth importer, `HeroPlayer.tsx`, had already been deferred long before. That
is precisely why one more deferral looked sufficient: the file that "obviously"
needed fixing was the last one anyone had noticed, not the last one that
mattered.

**The rule:** a dependency leaves the initial graph only when _no_ module in
that graph statically imports it. Before claiming a deferral works, diff
`.next/diagnostics/route-bundle-stats.json` across a real build. Find the chunk
by grepping the built output for a marker symbol of the dependency
(`mp4-remuxer` for hls.js, `litix` for mux-embed) rather than by name.

This is the [shared-predicate partial-rollout gap](../best-practices/shared-predicate-partial-rollout-gap-20260810.md)
wearing bundler clothes: the fix was applied to the call site the ticket already
pointed at, and the siblings were invisible because nothing in the diff touched
them.

### 2. Make it a single owner, and hold it with a whole-tree invariant

Four copies of the same `dynamic()` call is four chances to regress, and a
single new static importer anywhere silently puts the whole engine back on the
critical path with every behavioural test green. Put the seam in one module and
pin the property whole-tree
(`apps/web/src/components/__tests__/mux-video-deferral.test.ts`).

A source-regex guard standing in for a build-graph fact has to be broad enough
to catch every way back in. This one scans for four, each falsified once:

- a static import of the module, **including** prettier-wrapped multi-line,
  side-effect, and `export … from` forms;
- a **value** import of the package barrel, which re-exports the same module —
  every barrel import in the app is `import type` today and nothing enforces
  that (no `verbatimModuleSyntax`, no `consistent-type-imports`);
- a direct import of the upstream package, bypassing the workspace wrapper;
- a dropped `{ ssr: false }`, which is separately revertible and which no
  behavioural test covers because the `next/dynamic` test stub ignores options.

Strip comments before the membership test. Otherwise a doc comment naming the
module fails the guard, and the tempting repair is to loosen the allowlist —
the one edit that turns the guard into a no-op.

### 3. A load gate must park every timer only a mounted element could clear

Gating the above-the-fold player on `document.readyState === "complete"` keeps
the chunk off the load path. It also introduces a window in which the element
does not exist — and any pre-existing timer whose only escape is an event from
that element now runs unopposed.

Here the carousel's 12 s dead-stream ceiling was armed from mount and cleared
only by `canplay`. With the gate, a document whose `load` was held open by one
stalled subresource burned a hero slide every 12 s, wrote each into the
localStorage played set, and never showed a frame — unbounded, and worst for
exactly the slow clients the deferral was meant to help. Four reviewers found
it independently; no test could have, because jsdom reports `readyState:
"complete"` so every pre-existing case ran gate-open.

Thread the gate into the state machine (`mediaGateOpen`) and park the ceiling
on it. Falsify in **both** directions: removing the guard must redden a
closed-gate case, and pinning the gate shut must redden a re-arm case. One
direction alone lets "never arm it" pass as a fix.

### 4. Deferring a media surface changes its failure mode — contain it

A rejected `import()` throws during render. With no boundary it reaches the
route's `error.tsx` and replaces the **whole** page — copy, artwork, navigation
— over a video engine none of it needs. The rejection is cached at both the
bundler-runtime and `React.lazy` layers, so the error page's reset is inert
until a full reload
([feat-328](../best-practices/per-message-boundary-limits-for-media-surfaces.md)).

Wrap the lazy component in the owner module with an error boundary whose
fallback is `null`; every call site already reserves its box and paints a
poster, so nothing shifts and the degraded state is poster-only. Do **not** add
a userland retry around `import()` — inert on Turbopack.

### 5. Measure the mount window, on real data

`docs/solutions/conventions/frontend-change-page-load-performance-verification.md`
asks for two measurements, and the second one is the one that gets skipped
because the surface will not render without real data. Get the real data.

Installed before navigation, a `layout-shift` observer read after the player
mounted gave CLS **0.000** across the mount window, alongside
`videoCountAtLoad = 0`, the chunk requested at 152 ms against `loadEventEnd`
69 ms, and `readyState 4 / paused false / currentTime 13.47` proving hls.js
genuinely loaded. A structural "it is absolutely positioned inside a sized box"
argument is a reasonable _prediction_; it is not that measurement, and it
cannot tell you the element mounted and played at all.

## Related

- `docs/solutions/best-practices/shared-predicate-partial-rollout-gap-20260810.md`
- `docs/solutions/best-practices/per-message-boundary-limits-for-media-surfaces.md`
- `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`
- `docs/solutions/performance-issues/web-watch-route-lighthouse-perf-campaign-lcp-bundle-fonts-20260527.md`

---
title: 'Mux + hls.js with preload="none" leaves Chrome''s native controls spinning forever'
date: 2026-08-18
category: ui-bugs
module: apps/chat
problem_type: ui_bug
component: "video-card"
severity: medium
symptoms:
  - "Chrome's native video-controls spinner sits centered over the poster and never clears, no matter how long the page stays open"
  - "Clicking play starts playback normally — the bug is purely cosmetic, but every inline video card looks permanently broken/loading"
  - 'Element state stays { currentSrc: "blob:…", networkState: 2, readyState: 0, paused: true, error: null } indefinitely'
  - "jsdom unit tests stay green — the pinned preload prop test never fails"
root_cause: wrong_api
resolution_type: code_fix
related_components:
  - "apps/chat/src/components/chat/video-card.tsx"
  - "packages/video-player/src/MuxVideo.tsx"
  - "@mux/mux-video-react"
  - "@mux/playback-core"
  - "hls.js"
framework_version: "@mux/playback-core@0.34.1"
tags:
  - "mux"
  - "mux-video"
  - "hls"
  - "preload"
  - "video-card"
  - "chat"
  - "native-controls"
  - "spinner"
---

# Mux + hls.js with `preload="none"` leaves Chrome's native controls spinning forever

## Problem

The chat app's inline Seeker video card (feat-328) painted Chrome's built-in
buffering spinner over the poster permanently. Playback worked on click, so the
bug was purely cosmetic — but every card in every transcript looked broken, and
it was reported from real usage (operator screenshot), not from any test.

## Symptoms

- A centered spinner over the poster of `apps/chat/src/components/chat/video-card.tsx`,
  never clearing. It is **Chrome's own native-controls spinner** — chat renders no
  spinner of its own, so nothing in app code could be "turned off".
- Clicking play starts playback normally; the spinner is the only defect.
- Measured element state (headless Chromium harness in the devcontainer,
  2026-08-18), stable indefinitely:
  `currentSrc = "blob:…"` (a MediaSource), `networkState = 2` (`NETWORK_LOADING`),
  `readyState = 0` (`HAVE_NOTHING`), `paused = true`, `error = null`.
  Chrome paints the perpetual spinner for exactly that combination.
- No test signal at all: the jsdom suite
  (`apps/chat/src/components/chat/video-card.test.tsx`) pins the `preload` prop and
  stayed green through the whole bug and the fix.

## What Didn't Work

- **Looking for an app-side spinner to remove.** There is none. `video-card.tsx`
  renders `MuxVideo` inside a plain `aspect-video` box; the spinner comes from the
  `controls` attribute's native UI.
- **Trusting the unit tests.** The prop-shape assertion in `video-card.test.tsx:43`
  is exactly the kind of test that cannot see this class of bug: jsdom implements no
  HTMLMediaElement playback, so `networkState` / `readyState` never move there.
- **Assuming `preload="none"` was a considered decision.** Grep across the feat-328
  plan (`docs/plans/2026-08-02-001-feat-seeker-video-featuring-plan.md`), the ticket,
  commit `f45bd4d8` (PR #1832) found **zero** mentions of `preload` or bandwidth as
  rationale — the plan and ticket never mention it at all; the commit and PR contain
  only the added prop itself, no reasoning. It was an undocumented
  implementation-time thrift instinct, not a constraint to preserve. Chat was also the ONLY surface in the repo using `"none"` — other Mux
  surfaces set nothing (browser default) or `"metadata"`.
- **Proving the fix end-to-end in the harness.** Re-running the harness with
  `preload="metadata"` showed no spinner, but then hit `MEDIA_ERR_DECODE` (code 3),
  because the container's Playwright Chromium ships without H.264/AAC — and an
  errored media element does not paint the buffering spinner regardless of
  readyState, so that observation cannot separate "readyState advanced" from "the
  element errored out". Repo prior art is supporting but not conclusive either:
  `apps/web`'s `HeroPlayer.tsx:1655` uses `preload="metadata"` on the same
  `MuxVideo` wrapper (test-pinned at
  `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx:1131`), but it
  passes no `controls` attribute and autoplays, so it could never exhibit this
  spinner in the first place — it proves the wrapper tolerates `"metadata"`, not
  that `"metadata"` clears the spinner. **The mechanism read (below) is the load-
  bearing evidence; the user-visible confirmation is a real H.264-capable Chrome
  showing the card with poster, no spinner, and `error === null` — confirmed
  2026-08-18 by the operator on the local chat dev server with the fix applied.**

## Solution

One prop, plus a comment recording why (`apps/chat/src/components/chat/video-card.tsx:129-132`):

```text
// "metadata", not "none": hls.js attaches MediaSource at setup
// either way, and with "none" nothing ever loads, so Chrome's
// native controls spin forever (HeroPlayer uses the same value).
preload="metadata"
```

The pinned prop in `video-card.test.tsx:43` was updated to `"metadata"` in the same
change (it documents the choice; it does not detect the bug). The comment's
"hls.js attaches MediaSource" is 3-line-comment shorthand for the precise
mechanism below: playback-core calls hls.js's `attachMedia()` at setup, and hls.js
performs the attach.

## Why This Works

Read from the deminified `@mux/playback-core@0.34.1` `dist/index.mjs` — the version
chat's chain actually resolves (`@mux/mux-video-react@0.30.7` pins `0.34.1`;
`packages/video-player/src/MuxVideo.tsx` is the wrapper). The same handler is present
unchanged in `0.35.0`, which the MuxPlayer path resolves.
**Verified 2026-08-18 — re-verify on any Mux bump.** The preload handler has this shape:

```
update(val):
  reflect val onto the element's preload attribute
  effective = val ?? element.preload
  if (played || effective === "none") return          // <- "none" stops here
  if (effective === "metadata") { hls.config.maxBufferLength = 1
                                  hls.config.maxBufferSize   = 1 }
  else { restore the captured defaults }
  loadSource(src)                                      // once-guarded
once("play"): played = true; restore defaults; loadSource(src)
```

One unstated branch bounds the bug's browser scope: when there is no hls.js engine
(`if (!hls)` — native-HLS playback, i.e. Safari), the handler only reflects the
attribute and none of this applies. The bug is MSE-browsers-only (Chrome, Firefox, Edge).

The decisive detail is that playback-core **attaches the hls.js MediaSource to the
media element at setup, regardless of `preload`**. That attach alone fires `loadstart`,
which puts the element into `networkState = 2`. With `preload="none"`, `loadSource()`
is then never called before a `play` — so no manifest, no fragment, `readyState`
stays `0` forever. "Attached but never loaded" is a state Chrome's controls read as
"buffering", so they spin.

With `"metadata"`, `loadSource()` runs immediately under `maxBufferLength = 1` /
`maxBufferSize = 1` — the manifest plus roughly one media fragment (typically a few
hundred KB per card). `readyState` advances past `HAVE_NOTHING`, the spinner clears,
and the once-`play` listener restores the full buffer config for real playback.

**Trade-off, stated honestly:** `"metadata"` costs manifest + at least one fragment
per rendered card even if the user never plays it. **That per-card cost is an
unmeasured estimate, not a measurement** — hls.js loads the first fragment at its
starting ABR level, and a mid-ladder Mux fragment can exceed a megabyte, so "a few
hundred KB" may be off. The judgment that this is fine for chat rests on chat
showing a few cards per transcript; a surface rendering MANY cards must measure the
real per-card request count and bytes from the network panel first (this change
class falls under
`docs/solutions/conventions/frontend-change-page-load-performance-verification.md`).
Such a surface should not reach for `"none"` again — the alternative is a poster
facade (a plain `<img>` + play button, mounting the player on click): more code,
but zero pre-play network AND no spinner.

## Prevention

- **Diagnosis recipe for any eternal video spinner on a Mux/hls surface:** inspect the
  element triple `{ currentSrc, networkState, readyState }` BEFORE blaming app code.
  `blob:` + `2` + `0` persisting = "MediaSource attached but the source was never
  loaded" — a `preload`/loader-wiring problem, not a rendering or CSS problem.
- **jsdom cannot see this bug class.** jsdom implements no media loading, so a pinned
  `preload` prop test is documentation, not detection. Media-loading behavior needs a
  real browser (headless Chromium is enough for the STATE; note the container's build
  lacks H.264/AAC, so it cannot prove decode/playback).
- **A sibling's `preload` transfers only when the playback POSTURE matches — check
  three axes before copying:** native `controls` on/off, autoplay on/off, and
  hls.js/MSE vs native HLS. `apps/web`'s `HeroPlayer.tsx` matches chat's card on
  the wrapper and the hls.js engine but NOT on controls or autoplay (it renders its
  own control UI and autoplays), so it could never exhibit this spinner — chat's
  card was the repo's first surface combining native controls with a
  non-autoplaying hls.js element. Whatever value a new surface picks, the reason
  belongs in a comment beside the prop — this bug existed because a bandwidth
  instinct left no trace anywhere in plan, ticket, commit, or PR to argue with
  later.
- **Version-pin the mechanism.** The handler shape above was read from
  `@mux/playback-core@0.34.1` (chat's resolved version; identical in `0.35.0`) on
  2026-08-18 and is held by no test. Re-read `dist/index.mjs` on any `@mux/*` bump
  before relying on it. Concretely: the file ships minified on one line with
  mangled handler names (`Pe` in 0.34.1, `Le` in 0.35.0), so find the handler by
  searching for the literal allow-list `["","none","metadata","auto"]` and read
  the surrounding factory for the `"none"` early return, the metadata
  buffer-clamp, and the once-`play` restore.

## Related Issues

- `docs/solutions/best-practices/per-message-boundary-limits-for-media-surfaces.md` —
  the other `video-card.tsx` pitfall doc (feat-328 lineage): chunk-load caching and
  media `error` routing. Orthogonal failure class, same component.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` —
  the mocked-shape-vs-real-contract law this is another instance of (an empirical
  library-mechanism claim no mocked test could contradict).
- `apps/chat/src/components/chat/video-card.tsx` — the card and its `preload` comment
- `apps/web/src/components/watch/HeroPlayer.tsx:1655` + `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx:1131` — prior art
- `packages/video-player/src/MuxVideo.tsx` — the shared wrapper both surfaces use
- `docs/plans/2026-08-02-001-feat-seeker-video-featuring-plan.md` — feat-328 plan (no `preload` rationale)

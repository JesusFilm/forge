---
id: "feat-328"
title: "Chat inline video rendering from the result frame"
owner: "jian wei"
priority: "P1"
status: "not-started"
start_date: "2026-08-07"
duration: 2
depends_on:
  - "feat-327"
blocks:
  - "feat-329"
  - "feat-330"
tags:
  - "ai-pipeline"
  - "web"
---

## Problem

The terminal SSE `result` frame can now carry a featured video (feat-327),
but `apps/chat` neither parses nor renders it. The arc plan
(`docs/plans/2026-08-02-001-feat-seeker-video-featuring-plan.md`, unit U3)
renders it as an inline `@forge/video-player/mux-video` player — a sibling
block below the assistant text (the `SourcesList` pattern), never through the
markdown allowlist (plan D2) — with a defensive client projection that builds
the watch URL itself (plan D9/P7: no URL is ever trusted from the wire).

## Entry Points — Read These First

1. `docs/plans/2026-08-02-001-feat-seeker-video-featuring-plan.md` — read
   D2, D3, D9, P7, unit U3, and E1/E11 in the Evidence Base.
2. `apps/chat/src/lib/chat-stub.ts` — `streamSeekerReply`'s terminal-frame
   parsing + `toSources` (the defensive-projection pattern `toVideo`
   mirrors).
3. `apps/chat/src/lib/conversations.ts` — `Message` / `SeekerSource` (where
   `VideoAttachment` + `Message.video` land).
4. `apps/chat/src/lib/conversation-session.ts` — the success finalize (where
   `result.video` is carried onto the finalized message).
5. `apps/chat/src/components/chat/message-list.tsx` + `sources-list.tsx` —
   the sibling-block pattern and where `<VideoCard>` mounts.
6. `packages/watch-url-policy/src/routes.ts` —
   `buildCanonicalWatchVideoPath` + `DEFAULT_WATCH_LANGUAGE_SLUG` (the
   `@forge/watch-url-policy/routes` subpath — pure TS, client-safe).
7. `packages/video-player/` — the `mux-video` export web's watch hero uses.
8. `apps/chat/CLAUDE.md` — wire contract, testing conventions (RTL, jsdom,
   which tests run under node), markdown-allowlist discipline.
9. `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`
   — the perf-evidence bar this ticket MUST meet.

## Grep These

- `toSources` (projection pattern)
- `SourcesList` in `message-list.tsx` (sibling-block mounting points —
  streaming AND finalized branches)
- `isHttpsUrl` (the link gate the caption uses)
- `readSseStream` (the terminal-frame parse path)

## What To Build

Per plan U3 (full detail there):

1. Deps: `@forge/video-player` + `@forge/watch-url-policy` (workspace) in
   `apps/chat/package.json`.
2. `VideoAttachment` type (`{ videoId, title, playbackId, durationSeconds,
watchUrl }`) + optional `Message.video` in `lib/conversations.ts`.
3. `toVideo(value: unknown)` in `chat-stub.ts`: shape gates; playbackId
   pattern `^[A-Za-z0-9_-]{8,64}$`; slug/languageSlug pattern
   `^[a-z0-9][a-z0-9_-]{0,80}$` case-SENSITIVE lowercase-only (pinned in
   plan D9 — odd-cased values fail closed, and it is
   the sole control over the built URL's path); `watchUrl` CLIENT-BUILT as
   `"https://www.jesusfilm.org/watch" +
buildCanonicalWatchVideoPath(slug, languageSlug)` (absent/invalid
   languageSlug → default language). Terminal result carries
   `video: toVideo(d.video)`.
4. Session finalize carries `result.video` onto the finalized assistant
   message. TERMINAL-ONLY — no mid-stream `onVideo` callback exists (plan
   D3).
5. `components/chat/video-card.tsx` (new): player-only presentation — lazy
   `MuxVideo` via `next/dynamic` `ssr:false` (turns without video never
   download hls.js), derived poster
   (`https://image.mux.com/{playbackId}/thumbnail.jpg?...`), duration +
   title caption, watch-page link (https-gated). Presentational — no hooks,
   no `'use client'` (inherits like `sources-list.tsx`). Telemetry
   constraint (plan U3): pass `disableTracking`/`disableCookies` EXPLICITLY
   (never rely on package defaults) and no `metadata`/viewer-id/
   conversation-derived props — Mux receives only the pattern-gated
   playbackId + the chat origin; pin this with a test. Boundary constraint
   (plan U3): the card renders OUTSIDE `MarkdownRenderBoundary` and chat
   has no app-level boundary — wrap the video block in its own per-message
   error boundary (the `MarkdownRenderBoundary` pattern) so a
   MuxVideo/hls.js throw degrades that ONE turn, never the whole tree
   (feat-329 replay would otherwise make the crash durable per thread).
6. `message-list.tsx`: `<VideoCard>` sibling block after the markdown
   content in streaming + finalized branches.

## Constraints

- NEVER through the markdown element allowlist — `assistant-markdown.tsx` is
  untouched (plan D2).
- The proxy (`src/app/api/seeker/route.ts`) is UNTOUCHED — it already relays
  result frames verbatim. Assert; don't modify.
- No URL from the wire is ever rendered — `toVideo` ignores any wire
  `watchUrl` (test this with a hostile payload).
- No card variant, no URL knobs, no stub trigger turns — the prototype's
  demo affordances are retired.
- Player-only v1; the link-card presentation is deferred (plan Scope
  Boundaries).
- No new env vars, no egress/CSP change (browser talks to Mux directly —
  plan E11).

## Verification

- `pnpm --filter @forge/chat test` + `typecheck` green — the existing suite
  passes untouched plus new coverage (toVideo matrix incl. the hostile-URL
  vector and slug-pattern rejections, session finalize incl. the
  gate_denied stub-downgrade never carrying `video`, RTL rendering
  assertions, the telemetry pin, AND the error-boundary test: a VideoCard
  child that throws at render degrades that one turn to the boundary
  fallback while the rest of the transcript stays mounted — plan U3
  scenarios). RTL note: the `ssr:false` dynamic boundary resolves
  asynchronously under jsdom — use `findBy*` and expect to module-mock
  `@mux/mux-video-react`.
- Browser smoke in the headless Chromium: player mounts with poster on a
  video-bearing turn; clean layout at 390px. (In-container Chromium has no
  H.264 — mount+poster is the bar; playback is operator-verified.)
- **Page-load performance evidence (required, per the convention doc):**
  network-request listing proving hls.js/video-player chunks are ABSENT from
  initial page load and appear only when a video message renders, plus a
  load-timing comparison against main. Attach to the PR.

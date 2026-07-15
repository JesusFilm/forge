---
id: "feat-255"
title: "TV Showcase Mode: Settings tab + felt-need excerpt reel"
owner: "urim"
priority: "P1"
status: "in-progress"
start_date: "2026-07-20"
duration: 10
blocks:
  - "feat-256"
tags:
  - "tv"
  - "cms"
---

## Problem

Office TVs at the ministry sit dark or idle when stakeholders visit, and nothing in the TV app communicates the catalog's breadth: ~50-60 felt-need categories dubbed into hundreds of languages, growing continuously via AI pipelines. The product leader requested an electronics-store-style demo loop that plays logical excerpts from real catalog data. Shipped as a public consumer feature (ambient/showcase), not an office-gated hack.

The confirmed Product Contract lives in `docs/plans/2026-07-15-001-feat-tv-showcase-mode-plan.md` — it is the product authority for this ticket (requirements R1-R15, acceptance examples, key decisions including the "Showcase Mode" name).

## Entry Points — Read These First

1. `docs/plans/2026-07-15-001-feat-tv-showcase-mode-plan.md` — the requirements-only plan; read fully before any code.
2. `apps/tv/src/components/home/HomeTopBar.tsx` — the floating top bar to extend (Search + Home tabs today; a TODO already reserves room for more tabs; note the `onFocusNode`/`onSearchTabNode` focus-wiring props a new tab must participate in).
3. `apps/tv/app/_layout.tsx` — bare Expo Router `<Stack>`; a new settings route is just a new file under `apps/tv/app/`.
4. `apps/tv/src/lib/queries.ts` (`experienceBySlug` usage around line 298) — the public Experience query the curated reel loads through.
5. `apps/tv/src/lib/videoQueries.ts` — per-dub `hls`/`duration`/`language` fields powering language rotation.
6. `apps/tv/src/hooks/useWatchHome.ts` + `apps/tv/src/lib/watchHome/heroQueue.ts` — the Home pool and deterministic-queue pattern the fallback reel mirrors.
7. `apps/tv/src/lib/safeStorage.ts` — persistence wrapper for the mode's settings (start action + auto-start toggle).
8. `docs/solutions/ui-bugs/tv-backdrop-videoview-decoder-starvation-overlay-20260611.md` — the single-decoder rule that forbids two concurrent video players; transitions must crossfade via posters/stills.

## Grep These

- `experienceBySlug` — existing public Experience fetch path
- `HomeTopBar` / `TopBarTab` — tab bar extension point
- `WATCH_HOME_PLAYLIST_SEQUENCE` — fallback pool source
- `LABEL_TEXT` in `apps/tv/src/lib/watchHome/model.ts` — `SEGMENT` / `TRAILER` / `SHORT_FILM` labels the reel prefers
- `keep-awake|keepAwake` — currently zero hits in apps/tv; screensaver prevention needs a mechanism (deferred-to-planning question)
- `createVideoQoeSession` — existing playback QoE reporting to mirror (R15)

## What To Build

Per the plan: a Settings tab + screen (R1-R3); reel sourcing from a CMS-authored Showcase Experience with a client-composed fallback from the Home pool (R4-R7); chapter-journey presentation with minimal chrome and stat interstitials (R8-R11); consumer-safe mode behavior — any-press exit, opt-in auto-start, multi-hour unattended reliability, RUM view (R12-R15). Excerpts are existing short-form catalog videos; no clip-timecode machinery.

## Constraints

- No admin code or schema changes; the curated source is CMS content authoring only.
- Never run two video decoders concurrently (single-decoder rule).
- Consumer-safe defaults are non-negotiable: any remote press exits; auto-start defaults off.
- Felt-need chapter labels come from the Experience authoring — there is no felt-need taxonomy in the schema; do not invent one.
- Do not add SessionReplay/WebViewTracking packages (tvOS Datadog constraint) when wiring R15.

## Verification

- `pnpm --filter @forge/tv test` green (colocated vitest/jest suites for queue composition, settings persistence, fallback selection).
- Simulator smoke on tvOS AND Android TV: start mode from Settings tab, observe chapter card → excerpts → interstitial cycle, press any remote key to exit (see `docs/plans/2026-07-15-001-feat-tv-showcase-mode-plan.md` Acceptance Examples AE1-AE6).
- With no Showcase Experience published: fallback reel plays, no blank/error screen.
- Multi-hour soak on hardware before office launch: no screensaver, no wedge, stable memory.
- Showcase Experience authored in the CMS per the plan's KTD-10 (owner: urim until a curator is named) — gates office launch alongside the soak; until authored, office TVs run the fallback reel.

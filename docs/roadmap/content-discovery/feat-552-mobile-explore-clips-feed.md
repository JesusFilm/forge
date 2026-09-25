---
id: "feat-552"
title: "Mobile Explore clips feed"
owner: "urim"
priority: "P2"
status: "in-progress"
start_date: "2026-09-25"
duration: 21
depends_on: []
blocks: []
tags:
  - "mobile"
  - "recommendations"
---

## Problem

Each mobile tab asks a viewer to choose a title from a poster and a name before
they see any footage. The catalog is mostly long-form, so the first minute of a
video often does not show what the video is like. No surface lets a viewer
sample the catalog quickly in their own language.

## Entry Points — Read These First

1. `docs/plans/2026-09-24-1450-feat-mobile-explore-clips-feed-plan.md` — the
   unified plan: the Product Contract (R1–R47), the key technical decisions
   (KTD1–KTD25), and the implementation units (U1–U22).
2. `apps/tv/src/lib/showcaseMode/sentenceTiming.ts` — the sentence timing that
   the mobile clip engine copies.
3. `apps/mobile/src/components/home/HomeHeroPager.tsx` and
   `apps/mobile/src/lib/miniPlayer/heroYield.ts` — a player that a surface owns,
   and the continuous yield to the mini player.
4. `apps/mobile/src/lib/signInGate.ts` and `apps/mobile/src/lib/signInGateState.ts`
   — the release-bundle gate pattern that the Explore gate follows.
5. `apps/mobile/src/lib/recommendations/` — the recommendations client that
   Explore hosts and the clip evidence recorder extends.

## Grep These

- `EXPLORE_ENABLED`
- `EXPO_PUBLIC_EXPLORE_ENABLED|EXPO_PUBLIC_EXPLORE_ANDROID_ENABLED`
- `watchLanguageInventory`
- `preferredPlayableDub`
- `useFeedPlayers|useClipAutostart|useExploreClipQueue`

## What To Build

- An Explore tab in the second position, behind a bundle gate and an
  over-the-air kill switch.
- An endless vertical feed of 10–60 s clips in the viewer's feed language, cut
  at sentence boundaries from subtitle timing, with fallback clips when no
  timing exists.
- A three-slot pager with two feed-owned players, and a one-player mode for
  low-memory Android devices.
- "Keep watching", which opens the watch page at the clip's moment with a
  progress hold and a "Start from the beginning" offer.
- Capped clip recommendation evidence, and telemetry for the four product
  signals.

## Constraints

- `apps/mobile` only. Admin, web, and TV do not change.
- Clips never write Continue Watching progress.
- `expo-device` moves the fingerprint runtime version, so a native build must
  ship before any `eas update` reaches a tester.
- Release bundles keep Explore closed until an operator sets
  `EXPO_PUBLIC_EXPLORE_ENABLED`. Android testers also need
  `EXPO_PUBLIC_EXPLORE_ANDROID_ENABLED`, which stays unset until the low-end
  Android pass has run.

## Follow-Up Work

- TV (`apps/tv`, not this ticket): TV's `parseVtt` header and its sentence
  terminators drift from the extended mobile copies. Port the mobile SMPTE
  normalization header and the extra sentence terminators back to TV, or record
  why TV does not need them.
- An admin response cache for `watchLanguageInventory` before the public
  release.
- Admin-computed moments with a staff "hide this moment" control, before the
  public release.

## Verification

- `pnpm --filter @forge/mobile test`, `typecheck`, and `lint` pass.
- The release-mode bundle with the variable unset shows no Explore tab.
- The owner runs the iPhone and low-end Android device passes in the plan's
  Verification Contract.

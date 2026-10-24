---
title: "Standardize Web Video Thumbnail Interaction Frame - Plan"
type: fix
date: 2026-07-21
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: user-directed
execution: code
---

# Standardize Web Video Thumbnail Interaction Frame - Plan

## Goal Capsule

- **Objective:** Make one inset 4px solid-white frame the Web design-system
  hover and keyboard-focus treatment for every interactive video thumbnail.
- **Authority:** The user's explicit request to lock this effect across all
  video thumbnails supersedes the localized boundaries in the 2026-07-20 plan.
- **Scope:** Production video-thumbnail links/cards on Watch home, search,
  Experiences, chapter/episode surfaces, history, and language inventory.
- **Non-goals:** Static posters, embedded players, modal previews, quote images,
  search category tiles, and section-navigation artwork.
- **Tail ownership:** Update PR #1630 through the normal PR workflow; do not
  deploy production directly.

## Product Contract

### Requirements

- R1. Hover and `focus-visible` reveal the same continuous inset 4px white
  frame around the thumbnail surface.
- R2. Interactive thumbnail roots suppress native outlines and colored focus
  rings so the shared frame is the only focus indicator.
- R3. The frame inherits the thumbnail radius and sits above previews, copy,
  progress, and bevel layers without changing their behavior.
- R4. Existing active-card and pending-navigation indicators remain distinct.
- R5. Video-thumbnail interaction styling contains no red/amber border, glow,
  gradient, or orientation-specific frame utility.
- R6. The rule is represented by one shared component and contract test so
  future consumers can adopt it without copying class strings.

## Planning Contract

### Key Technical Decisions

- KTD1. Add `VideoThumbnailInteractionFrame`, a stateless shared overlay using
  inherited radius, `inset-0`, `z-[80]`, `border-4`, and `border-white`.
- KTD2. Export one focus-target class for suppressing native outlines; retain
  consumer-specific opacity, motion, active, and pending behavior.
- KTD3. Place the frame inside the visual thumbnail region when a card has
  metadata outside the image, and at the card root when the thumbnail is the
  complete card surface.
- KTD4. Remove the obsolete Watch home red-gradient CSS. Rename the remaining
  red search-category utility so it cannot be mistaken for a video-card token.

## Implementation Units

### U1. Add and prove the shared interaction-frame primitive

- **Files:** `apps/web/src/components/ui/video-thumbnail-interaction-frame.tsx`
  and its test.
- **Approach:** Lock the shared frame/focus classes and optional active/pending
  visibility controls in a focused component contract test.
- **Verification:** The test proves hover/focus parity, white 4px geometry,
  inherited radius, no colored styling, and native-outline suppression token.

### U2. Migrate existing outlined thumbnail families

- **Files:** Watch home cards/carousel, search `VideoCard`, `MediaCollection`,
  `CarouselVideo`, `SiblingCarousel`, and their existing tests.
- **Approach:** Replace local red/white frame strings with the shared primitive;
  suppress native outlines; preserve active/pending and opacity behavior.
- **Verification:** Existing consumer tests assert the shared white contract and
  reject old red/gradient/native-outline classes.

### U3. Cover remaining production thumbnail families

- **Files:** `SeriesEpisodeCard.tsx`, `WatchHistoryClient.tsx`, and
  `LanguageInventoryPage.tsx`, with focused coverage where test seams exist.
- **Approach:** Add the shared frame at the thumbnail surface and remove amber or
  native focus rings from the interactive root.
- **Verification:** Component contracts plus browser smoke prove consistent
  pointer/keyboard treatment without routing or preview regressions.

### U4. Remove legacy styling and lock scope

- **Files:** `apps/web/src/app/globals.css`, relevant category tests, roadmap,
  and durable solution documentation.
- **Approach:** Delete unused Watch gradient rules; rename the red search
  category utility; document the video-thumbnail default and exclusions.
- **Verification:** Repository search finds no legacy Watch gradient use and no
  red/amber interaction frame on the enumerated video-thumbnail consumers.

## Verification Contract

| Gate                 | Done signal                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| Focused tests        | Shared-frame and migrated consumer suites pass.                                                 |
| Type safety          | `pnpm --filter @forge/web typecheck` passes.                                                    |
| Static quality       | Scoped ESLint, touched-file Prettier, and `git diff --check` pass.                              |
| Visual/accessibility | Pointer hover and Tab focus show the same white frame on every migrated surface.                |
| Performance          | No new requests, effects, listeners, or client initialization; page-load behavior is unchanged. |
| Review               | `ce-code-review` has no unresolved actionable finding.                                          |

## Definition of Done

- R1-R6 and U1-U4 are complete.
- All production interactive video-thumbnail families use the shared frame.
- Legacy red/amber/native thumbnail focus treatments are absent.
- Tests, typecheck, lint, formatting, browser smoke, performance review, and
  code review pass.
- The roadmap ticket records completion evidence and returns to `complete`.

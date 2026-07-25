---
id: "feat-189"
title: "Watch caption language availability"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-15"
duration: 1
depends_on:
  - "feat-146"
blocks: []
tags:
  - "web"
  - "watch-page"
  - "subtitles"
  - "accessibility"
---

## Problem

The Watch page subtitle overlay can enable a subtitle track whose language does
not match the current audio/page language. On
`/watch/jesus-is-brought-to-pilate.html/english.html`, the live payload has
subtitle tracks but no English track, so enabling subtitles can fall through to
the first available track, Arabic, instead of making the English caption gap
explicit. At the same time, users may intentionally watch English audio with
translated subtitles, so translated subtitle tracks must remain selectable.

## Entry Points - Read These First

1. `docs/plans/2026-06-15-003-fix-watch-caption-language-availability-plan.md`
   - focused plan and production evidence.
2. `apps/web/src/components/watch/WatchPageClient.tsx`
   - owns subtitle preference initialization and selected overlay track.
3. `apps/web/src/components/watch/LanguagePickerModal.tsx`
   - renders the language modal subtitle toggle and selector.
4. `apps/web/src/components/watch/HeroPlayer.tsx`
   - injects the selected VTT track into the video element.
5. `docs/solutions/ui-bugs/watch-caption-language-availability-20260615.md`
   - reusable rule for same-audio-language caption availability.

## Grep These

- `resolveSubtitleSlug`
- `currentSubtitleEnabled`
- `watch-language-picker-subtitles-unavailable`
- `subtitleVttSrc`

## What To Build

1. Restrict automatic/default overlay subtitle selection to caption tracks whose
   language slug matches the current audio language slug.
2. When the current audio language has no matching subtitle track, keep
   subtitles disabled by default and show an explicit unavailable state in the
   language modal instead of silently selecting unrelated subtitle languages.
3. Preserve intentional translated subtitle selection by allowing users to pick
   other subtitle languages and storing those choices as explicit v2
   preferences.
4. Preserve the existing preference cookie, but do not let a legacy stale
   preference for another language select mismatched captions on a new audio
   language.
5. Add focused regression coverage for English/Spanish audio with only
   translated subtitle data.

## Constraints

- Do not change transcript rendering behavior covered by `feat-146`.
- Do not change video/audio variant selection or public `/watch` URL shape.
- Do not hand-edit generated GraphQL artifacts.
- The content/data backlog for creating missing English or Spanish captions is
  out of scope for this UI contract fix.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/LanguagePickerModal.test.tsx src/components/watch/__tests__/WatchPageClient.download.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke a local Watch route with Helium and verify the language modal
  presents an explicit unavailable subtitle state when no same-language track
  exists while still allowing translated subtitle selection.

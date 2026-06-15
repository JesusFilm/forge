# Fix Watch Caption Language Availability Plan

## Scope

Fix the Watch subtitle overlay UX so captions never default to a different
language than the current audio/page language. The motivating production route
is `https://watch.jesusfilm.org/watch/jesus-is-brought-to-pilate.html/english.html`.

## Evidence

- Production HTML returned `200` with `data-testid="watch-page-client"` and no
  `Internal Server Error`.
- The English route payload has `languageSlug: "english"` and subtitle tracks
  including Arabic, Chinese, Czech, Finnish, Hunsrik, Okinawan, Sunda, Tarifit,
  and Vietnamese, but no English track.
- The Spanish Castilian route likewise has `languageSlug:
"spanish-castilian"` with no Spanish subtitle track in the payload.
- `WatchPageClient.resolveSubtitleSlug(...)` currently falls back to
  `primary`/first subtitle when no audio-language match exists, which allows
  Arabic to become the selected caption after subtitles are enabled.

## Implementation

1. Add a small helper in `WatchPageClient.tsx` that filters subtitles to the
   current audio language slug and use it for overlay selection.
2. Initialize subtitle enabled state only when the user preference is enabled
   and a same-language track exists.
3. When the audio language changes or the subtitle list changes, clear a stale
   selected subtitle slug if it no longer matches the current audio language.
4. Pass only same-language subtitle options into `LanguagePickerModal`.
5. In `LanguagePickerModal.tsx`, render an explicit unavailable message under
   the subtitles heading when no same-language options exist; keep the toggle
   disabled and the selector hidden.
6. Add focused tests for the mismatch case:
   - Watch page opens the language modal with subtitles disabled and no
     mismatched language passed to the modal.
   - Language modal shows the unavailable state when subtitles are absent for
     the current audio language.

## Verification

- Run focused Vitest suites:
  - `pnpm --filter @forge/web test -- src/components/watch/__tests__/LanguagePickerModal.test.tsx src/components/watch/__tests__/WatchPageClient.download.test.tsx`
- Run `pnpm --filter @forge/web typecheck`.
- Smoke a local Watch route with Helium and capture a screenshot of the
  language modal unavailable state.

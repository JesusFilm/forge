# Fix Watch Caption Language Availability Plan

## Scope

Fix the Watch subtitle overlay UX so captions never default to a different
language than the current audio/page language while still allowing users to
intentionally choose translated subtitles. The motivating production route is
`https://watch.jesusfilm.org/watch/jesus-is-brought-to-pilate.html/english.html`.

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
   current audio language slug and use it for safe default overlay selection.
2. Initialize subtitle enabled state only when the user preference is enabled
   and either a same-language track exists or a translated subtitle was stored
   as an explicit v2 preference.
3. When the audio language changes or the subtitle list changes, clear a legacy
   selected subtitle slug if it no longer matches the current audio language.
4. Pass all subtitle options into `LanguagePickerModal` so translated subtitles
   remain user-selectable.
5. In `LanguagePickerModal.tsx`, render an explicit unavailable message under
   the subtitles heading when no same-language options exist; keep the toggle
   enabled only when translated subtitle options exist and require an explicit
   subtitle language selection before Apply.
6. Add focused tests for the mismatch case:
   - Watch page opens the language modal with legacy translated subtitle
     preferences disabled.
   - Watch page restores explicit v2 translated subtitle preferences.
   - Language modal shows the unavailable same-language caption state while
     allowing translated subtitle selection.

## Verification

- Run focused Vitest suites:
  - `pnpm --filter @forge/web test -- src/components/watch/__tests__/LanguagePickerModal.test.tsx src/components/watch/__tests__/WatchPageClient.download.test.tsx`
- Run `pnpm --filter @forge/web typecheck`.
- Smoke a local Watch route with Helium and capture a screenshot of the
  language modal unavailable state with translated subtitle options preserved.

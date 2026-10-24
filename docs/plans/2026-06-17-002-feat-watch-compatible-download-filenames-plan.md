---
title: "Watch compatible download filenames"
type: feat
status: completed
date: 2026-06-17
origin: docs/brainstorms/2026-06-17-watch-compatible-download-filenames-requirements.md
---

# Watch compatible download filenames

## Summary

Generate portable, self-identifying Watch download filenames such as
`Jesus-Film_English_eng_360p.mp4` from the selected Dub and selected rendition.
The existing same-origin download proxy remains the delivery boundary.

---

## Problem Frame

Field teams download and copy many films across many languages. The current
title-plus-tier filename does not identify the selected audio language, language
code, or actual resolution, so teams manually rename files and can still confuse
same-name or regional language variants.

---

## Requirements

### Filename Content

- R1. Watch download filenames must include sanitized title, selected audio
  language name, language code, and rendition label segments in that order.
- R2. Language code must prefer `Language.iso3`, then fall back to another
  stable language identifier when ISO 639-3 is unavailable.
- R3. Rendition label must prefer `VideoDubDownload.height` as `{height}p`,
  then fall back to the selected download tier.
- R4. Current MP4 downloads must keep a `.mp4` extension.

### Compatibility

- R5. Generated filenames must use only ASCII letters, ASCII digits, hyphen,
  underscore, and period.
- R6. Spaces, brackets, punctuation, path separators, control characters,
  trailing dots, trailing spaces, and non-ASCII characters must be normalized or
  removed from generated filenames.
- R7. Empty or unsafe title, language, code, or rendition metadata must fall
  back to non-empty safe segments without blocking the download.
- R8. Same-name languages must remain distinguishable when their stored language
  codes differ.

### Download Boundary

- R9. The selected Dub's audio language must drive the filename, not UI locale
  or browser language.
- R10. The download flow must keep the existing Terms of Use gate, account gate,
  same-origin proxy, range behavior, and SSRF defenses unchanged.
- R11. The client must not expose raw `VideoDubDownload.url` values.
- R12. Subtitle language text must remain out of scope unless the downloaded
  media file itself contains subtitle tracks.

---

## Key Technical Decisions

- **Use one compatible default format:** The spaced/bracketed convention is more
  readable, but `Title_Language_code_360p.mp4` with hyphenated text segments is
  safer for conservative file browsers and microSD workflows.
- **Extend the existing Watch data contract only with needed metadata:**
  `Language.iso3` and `VideoDubDownload.height` already exist in Admin GraphQL,
  so Web can select and normalize those fields without changing Admin schema.
- **Keep filename generation client-side and proxy sanitization server-side:**
  the browser needs the suggested filename before creating the anchor, while
  `/watch/api/download` remains the final `Content-Disposition` sanitizer.
- **Use selected rendition height instead of the bucket label when present:**
  `low` and `high` remain safe fallbacks, but they no longer carry enough
  operational meaning for downloaded-file sorting.
- **Do not infer subtitle filenames from player state:** Watch subtitle
  selections are player choices, not proof that the MP4 download embeds
  subtitles.

---

## Implementation Units

### U1. Add filename metadata to selected Watch data

- **Goal:** Select and normalize the language code and download height needed by
  the filename builder.
- **Files:** `apps/web/src/lib/fragments/watch-video.ts`,
  `apps/web/src/lib/fragments/__tests__/watch-video.test.ts`,
  `apps/web/src/lib/content.ts`,
  `apps/web/src/components/watch/download-options.ts`.
- **Patterns:** Add `iso3` to the selected Dub language fragment and `height`
  to download selections. Do not select or expose raw download URLs.
- **Test Scenarios:** Fragment tests cover the added fields; normalization keeps
  null-safe language and download metadata.

### U2. Replace title-tier filename generation

- **Goal:** Make `buildDownloadFilename` produce the compatible format and
  handle unsafe or missing metadata.
- **Files:** `apps/web/src/components/watch/download-link.ts`,
  `apps/web/src/components/watch/__tests__/download-link.test.ts`.
- **Patterns:** Normalize text to ASCII, join words within title/language
  segments with hyphens, join major segments with underscores, lower-case code
  segments, and keep only `.mp4` for current Watch video downloads.
- **Test Scenarios:** Exact `Jesus-Film_English_eng_360p.mp4` example, missing
  ISO fallback, missing height fallback, same-name language disambiguation,
  non-ASCII normalization, punctuation stripping, and empty metadata fallbacks.

### U3. Wire modal and fallback hrefs to selected metadata

- **Goal:** Pass selected Dub and selected rendition metadata through both the
  modal click path and the fallback download link path.
- **Files:** `apps/web/src/components/watch/DownloadModal.tsx`,
  `apps/web/src/components/watch/WatchPageClient.tsx`,
  `apps/web/src/components/watch/__tests__/DownloadModal.test.tsx`,
  `apps/web/src/components/watch/__tests__/WatchPageClient.download.test.tsx`.
- **Patterns:** Keep the existing proxy URL shape and anchor creation behavior.
  Only the `filename` query value and `download` attribute should change.
- **Test Scenarios:** Modal tests assert the compatible filename in the proxy
  URL and anchor `download`; Watch page tests assert hrefs remain same-origin.

### U4. Validate proxy compatibility and roadmap state

- **Goal:** Confirm route sanitization still accepts the new compatible filename
  and mark the roadmap item complete after local validation.
- **Files:** `apps/web/src/app/api/download/route.test.ts`,
  `docs/roadmap/topic-experiences/feat-196-watch-compatible-download-filenames.md`.
- **Patterns:** Add route coverage only if existing tests do not already prove
  `Content-Disposition` preserves compatible filenames.
- **Test Scenarios:** Direct proxy response uses the generated filename; feature
  ticket status reflects shipped work.

---

## Acceptance Examples

- AE1. Given title `Jesus Film`, audio language `English`, ISO 639-3 `eng`,
  and height `360`, the saved filename is
  `Jesus-Film_English_eng_360p.mp4`.
- AE2. Given two `Karo` languages with codes `kxh` and `arr`, their downloaded
  filenames differ by the code segment.
- AE3. Given a download without height, the rendition segment falls back to the
  selected tier such as `low`.
- AE4. Given a title and language with punctuation or non-ASCII characters, the
  filename contains only ASCII letters, digits, hyphen, underscore, and period.
- AE5. Given Watch subtitles are enabled in the player, the downloaded MP4
  filename still names only the selected audio language unless embedded
  subtitle metadata is available.

---

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/download-link.test.ts src/components/watch/__tests__/DownloadModal.test.tsx src/components/watch/__tests__/WatchPageClient.download.test.tsx src/lib/fragments/__tests__/watch-video.test.ts src/app/api/download/route.test.ts`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke on a Watch page confirms the download href remains
  same-origin and the `filename` parameter uses the compatible format.

---

## Risks & Dependencies

- Existing production data may have null `iso3` or null `height`; fallbacks must
  be tested because those cases cannot block downloads.
- Browser `download` hints are advisory, so the proxy `Content-Disposition`
  filename remains the source of truth for direct proxy responses.
- If gql.tada reports missing fields after the Web fragment changes, regenerate
  Admin GraphQL client artifacts instead of hand-editing generated outputs.

---

## Sources / Research

- `docs/brainstorms/2026-06-17-watch-compatible-download-filenames-requirements.md`
  defines the accepted filename convention and compatibility constraints.
- `docs/roadmap/topic-experiences/feat-196-watch-compatible-download-filenames.md`
  tracks this feature and its verification surface.
- `apps/web/src/components/watch/download-link.ts` owns the current
  `buildDownloadFilename` helper and proxy URL builder.
- `apps/web/src/components/watch/DownloadModal.tsx` creates the browser anchor
  used for downloads.
- `apps/web/src/components/watch/WatchPageClient.tsx` maps selected Dub
  downloads into modal props and fallback links.
- `apps/web/src/lib/fragments/watch-video.ts` defines the selected Dub detail
  data fetched from Admin GraphQL.
- `apps/admin/schema.graphql` exposes `Language.iso3` and
  `VideoDubDownload.height`.
- `apps/web/src/app/api/download/route.ts` sanitizes the response filename and
  sets `Content-Disposition`.

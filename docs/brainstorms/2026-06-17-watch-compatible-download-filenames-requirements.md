---
date: "2026-06-17"
topic: "watch-compatible-download-filenames"
title: "Watch Compatible Download Filenames"
type: "requirements"
---

# Watch Compatible Download Filenames

## Summary

Watch downloads should default to portable, self-identifying filenames such as `Jesus-Film_English_eng_360p.mp4`. The filename should identify the film, audio language, stable language code, and actual rendition height while staying compatible with common computer filesystems, microSD cards, and older media players.

---

## Problem Frame

Field teams download hundreds of films each quarter and often load many languages onto microSD cards or devices for regional distribution. The current downloaded filename is too generic, so teams manually rename files after each download to avoid putting the wrong language or rendition onto a device.

The manual rename step is especially error-prone when languages share a display name, when regional versions exist for the same broad language, or when quality labels such as "Low Resolution" do not reveal the actual file height. The filename needs to carry enough identifying information that a helper can sort files correctly without speaking the language or reopening the Watch page.

---

## Key Decisions

- **Use the compatible filename format by default.** Prefer `Jesus-Film_English_eng_360p.mp4` over `Jesus Film - English [eng] 360p.mp4` because spaces and square brackets are less reliable on older DVD, USB, and embedded media players.
- **Treat the audio language as the identity anchor.** The filename describes the selected Dub's audio language, not the UI locale or browser language.
- **Prefer actual rendition height over tier labels.** Use `360p`, `720p`, or the closest available height-derived label when available; keep `low`, `high`, or `highest` only as fallback.
- **Mention subtitles only when the downloaded media contains them.** Do not add subtitle language text based only on the Watch player's optional subtitle selection.
- **Preserve the existing download security boundary.** Filename improvement must not expose raw CDN URLs or weaken the same-origin download proxy.

---

## Actors

- A1. **Field media coordinator** - Downloads many Watch videos and prepares language sets for teams.
- A2. **Loading helper** - Copies downloaded files onto microSD cards or devices and relies on filenames to avoid mixups.
- A3. **Watch downloader** - Selects a language and rendition from the public Watch download flow.
- A4. **Watch system** - Supplies safe filenames to the browser while streaming media through the existing download path.

---

## Requirements

**Filename Content**

- R1. Each Watch download filename must include a sanitized film title, selected audio language name, language code, and rendition label.
- R2. The language code must prefer ISO 639-3 when available because it distinguishes same-name languages used in different regions.
- R3. The rendition label must prefer actual pixel height such as `360p` or `720p` when known.
- R4. The filename extension must match the downloaded media type, with `.mp4` remaining the expected default for current Watch video downloads.

**Compatibility Format**

- R5. The default filename must use only ASCII letters, ASCII digits, hyphen, underscore, and period.
- R6. Spaces, square brackets, parentheses, apostrophes, ampersands, commas, plus signs, and non-ASCII characters must be removed or normalized from the default filename.
- R7. Filename segments must be joined in a stable order: title, language name, language code, rendition label.
- R8. The filename must avoid platform-hostile forms such as path separators, control characters, trailing dots, trailing spaces, and Windows reserved device names.

**Fallback Behavior**

- R9. Missing language code must not block download; fall back to another stable language identifier and keep the rest of the filename useful.
- R10. Missing rendition height must not block download; fall back to the current tier label.
- R11. Missing or empty title or language text must fall back to safe generic segments without producing an empty filename.
- R12. Same-name language cases must remain distinguishable when their stored language codes differ.

**Download Experience**

- R13. The user should not need to edit the filename manually for the common case after downloading from Watch.
- R14. The browser's final saved filename must match the generated filename for both normal clicks and direct download-proxy responses.
- R15. Existing Terms of Use, account-gate, same-origin proxy, resumable download, and SSRF protections must remain unchanged.

---

## Key Flows

- F1. Download a known film language
  - **Actors:** A3, A4
  - **Steps:** The user opens the Download modal, accepts the Terms of Use, selects a rendition, and starts the download.
  - **Outcome:** The browser saves a file named like `Jesus-Film_English_eng_360p.mp4`.
  - **Covered by:** R1, R2, R3, R5, R13, R14

- F2. Prepare a multilingual device
  - **Actors:** A1, A2
  - **Steps:** A coordinator downloads several languages, then a helper copies files onto a microSD card.
  - **Outcome:** The helper can identify title, language, language code, and rendition from each filename without reopening Watch.
  - **Covered by:** R1, R2, R7, R12, R13

- F3. Download with incomplete metadata
  - **Actors:** A3, A4
  - **Steps:** The user downloads a video whose selected Dub or rendition lacks one preferred metadata field.
  - **Outcome:** The download still succeeds with safe fallback segments.
  - **Covered by:** R9, R10, R11, R15

---

## Acceptance Examples

- AE1. English known height
  - **Given:** The film title is `Jesus Film`, audio language is `English`, ISO 639-3 is `eng`, and rendition height is `360`.
  - **When:** The user downloads that rendition.
  - **Then:** The saved filename is `Jesus-Film_English_eng_360p.mp4`.
  - **Covers:** R1, R2, R3, R5, R7

- AE2. Same display name, different language codes
  - **Given:** Two downloadable languages share the display name `Karo` but have different stored language codes.
  - **When:** A user downloads the same film in both languages.
  - **Then:** The resulting filenames differ by language code.
  - **Covers:** R2, R12

- AE3. Missing height fallback
  - **Given:** A selected rendition has a quality tier but no stored height.
  - **When:** The user downloads it.
  - **Then:** The filename uses the tier label in the rendition segment rather than omitting the segment.
  - **Covers:** R10

- AE4. Player subtitles enabled
  - **Given:** The user has enabled Watch subtitles in French while downloading English audio.
  - **When:** The downloaded MP4 does not contain embedded subtitles.
  - **Then:** The filename names the English audio language and does not claim French subtitles.
  - **Covers:** R1, R15

---

## Success Criteria

- Downloaded filenames are self-identifying enough for field teams to sort files without manual renaming in the common case.
- Filenames remain safe on macOS, Windows, Linux, FAT32, exFAT, and conservative media-player file browsers.
- Existing Watch download tests still prove raw media URLs are not exposed to the browser.
- Regression tests cover exact filename examples, fallback behavior, and filename sanitization edge cases.

---

## Scope Boundaries

- Bulk download queues, ZIP packaging, and manifest export are deferred.
- Editing the actual media file contents is out of scope.
- Subtitle-language naming is out of scope unless the downloaded asset includes subtitle tracks.
- Changing the visible Download modal layout is out of scope unless a small label is needed to preview the generated filename.
- Reworking the download proxy route shape or authentication model is out of scope.

---

## Dependencies / Assumptions

- The selected audio language has or can expose ISO 639-3, BCP-47, slug, or another stable fallback identifier.
- Download rendition metadata has or can expose height for the selected file.
- The browser and proxy continue to honor the generated filename through the existing `Content-Disposition` path.
- The compatible default may be less readable than the spaced/bracketed convention, but reliability matters more for this workflow.

---

## Sources / Research

- `apps/web/src/components/watch/download-link.ts` - current title-plus-tier filename builder.
- `apps/web/src/components/watch/DownloadModal.tsx` - current download modal and browser anchor creation.
- `apps/web/src/app/api/download/route.ts` - current filename sanitization and `Content-Disposition` response.
- `apps/web/src/lib/fragments/watch-video.ts` - selected Dub detail data currently used by Watch.
- `apps/admin/schema.graphql` - Admin exposes language and download metadata needed for richer filenames.
- `docs/plans/2026-06-12-005-fix-watch-download-target-lookup-plan.md` - recent download-proxy hardening context.
- `docs/roadmap/platform/feat-146-web-user-accounts-download-gate.md` - existing download gate and proxy boundary.

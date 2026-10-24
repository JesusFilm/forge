# Video Subtitle Controls — Requirements

**Date:** 2026-05-25
**Author:** Urim
**Status:** Ready for planning

## Problem

The web video details page has no subtitle support. Users who want captions — whether for accessibility, language learning, or watching in noisy/quiet environments — have no way to enable them. The admin data model already stores VTT subtitle tracks per video edition, but the web app doesn't fetch or render them.

## Users

Anyone watching videos on the web app who wants text captions overlaid on the video. This includes deaf/hard-of-hearing users, non-native speakers, and users in sound-sensitive environments.

## Requirements

### R1: Subtitle section in language picker modal

Add a "Subtitles" section below the existing "Language" section in the language picker modal dialog. The section includes:

- **Header row:** "Subtitles" label (left), toggle switch (center-left), subtitle count "{N} languages" (right)
- **Language dropdown:** Same `LanguageCombobox` component as the language section, showing available subtitle languages. Disabled when the toggle is off.

Only visible when the current video's edition has at least one subtitle with a VTT source URL. When no subtitles exist, the section is hidden entirely — the modal shows only the language picker as it does today.

### R2: Toggle switch for subtitles

A switch control next to the "Subtitles" heading that turns subtitle display on or off. When toggled off, the subtitle language dropdown is disabled (visually dimmed) and no text track is active on the player. When toggled on, the selected subtitle language's VTT track is rendered.

### R3: Subtitle language selection

A searchable dropdown (reusing `LanguageCombobox`) listing all available subtitle languages for the current video's edition. Sorted alphabetically by English name, same as the audio language list. Shows the current selection and allows switching to any available subtitle language.

### R4: Apply button applies both language and subtitle changes

The existing Apply button commits both the audio language selection AND the subtitle selection (on/off + language) in a single action. Close discards both pending changes.

### R5: Cookie-persisted subtitle preference

Subtitle state (on/off and selected language slug) persists across videos and sessions via cookie, following the same pattern as the existing `writePreferredLanguageSlug()` / language preference cookie. When a user navigates to a new video:

- If subtitles were on, they remain on.
- If the persisted subtitle language is available for the new video, use it.
- If not available, fall back to the subtitle matching the current audio language. If that's also unavailable, fall back to the primary subtitle (where `primary: true`), then to the first available subtitle.

### R6: Default subtitle language

When a user enables subtitles for the first time (no persisted preference), the default subtitle language matches the current audio language (the selected dub). If no subtitle exists for that language, use the primary subtitle, then the first available.

### R7: VTT text track rendering on Mux Player

When subtitles are enabled, render the selected subtitle's `vttSrc` as an active text track on the Mux Player. The track should display as standard bottom-of-frame captions. When subtitles are toggled off or the modal is closed without applying, no track is active.

### R8: GraphQL fragment extension

Extend the `watchVideoFragment` to fetch subtitle data through the variant's edition: each variant's `videoEdition.subtitles` including `language { slug, name, bcp47 }`, `vttSrc`, `primary`, and `aiGenerated`. Deduplicate at the component level since all dubs in the same edition share the same subtitle list.

## Non-goals

- Subtitle upload, editing, or management (admin-side concerns)
- Subtitle styling/customization beyond browser defaults
- Subtitle support on the series page (series pages have no player)
- Changes to the admin app
- SRT track support (VTT only, which is what browsers and Mux Player natively support)

## Success criteria

1. User can toggle subtitles on/off from the language picker modal
2. User can select from all available subtitle languages
3. Subtitles render correctly over the video in the selected language
4. Preference persists across page navigation and browser sessions
5. Videos without subtitles show no subtitle controls
6. Accessibility: toggle and dropdown are keyboard-navigable and screen-reader-announced

## Visual reference

The modal layout matches the attached screenshot: Language section on top, Subtitles section below with toggle + dropdown, Close/Apply buttons at the bottom.

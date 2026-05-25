---
title: "feat: Add video subtitle controls to watch page"
status: active
origin: docs/brainstorms/2026-05-25-web-video-subtitle-controls-requirements.md
created: 2026-05-25
---

# feat: Add Video Subtitle Controls to Watch Page

## Problem Frame

The web video details page has no subtitle support. Admin's data model stores VTT subtitle tracks per video edition (`VideoEdition.subtitles`), but the web app neither fetches nor renders them. Users who need captions — for accessibility, language learning, or environment constraints — have no way to enable them.

## Scope Boundaries

### In scope

- Subtitle section in the language picker modal (toggle + language dropdown)
- VTT text track rendering on the Mux Player
- Client-side cookie persistence for subtitle preference
- GraphQL fragment extension to fetch subtitle data
- New Switch UI component (wrapping `@base-ui/react/switch`)

### Out of scope

- Subtitle upload, editing, or management (admin-side)
- Subtitle styling/customization beyond browser/Mux defaults
- Series page subtitle support (no player on series pages)
- SRT-only tracks (VTT is the browser-native format)
- In-chrome CC button (all subtitle controls live in the language picker modal)

### Deferred to Follow-Up Work

- Subtitle preference middleware redirect (if future requirements need server-side subtitle routing)
- LanguageCombobox virtualization (non-virtualized list works for typical subtitle counts)

---

## Key Technical Decisions

### Client-side-only cookie access for subtitle preference

Subtitle on/off and language slug persist via `document.cookie` (client-side write) and a client-side read helper. Never read via `cookies()` from `next/headers` in a page route or Server Component — this silently defeats ISR and the Full Route Cache (see `docs/solutions/web/nextjs-headers-defeats-route-cache.md`). The existing language preference already solved this: `writePreferredLanguageSlug` writes client-side, the middleware in `proxy.ts` handles server-side reads. Subtitle preference doesn't need middleware, so client-side-only is sufficient.

### Subtitle data lifted to WatchVideoRecord level

All dubs within the same edition share identical subtitles. Rather than carrying a `subtitles` array on every `WatchVariant`, the normalization layer extracts subtitles from the selected variant's edition onto `WatchVideoRecord` as a deduplicated array. This avoids redundant data in the component tree and makes the subtitle list a sibling of `variants`, not nested within each one. If a video has dubs across multiple editions (different cuts), subtitles come from the edition of the currently selected variant — different editions have different timecodes, so subtitles from other editions would be out of sync.

### Switch component wrapping base-ui

`@base-ui/react/switch` is already a dependency (`@base-ui/react@^1.2.0` in `apps/web/package.json`). Creating a thin wrapper at `src/components/ui/switch.tsx` follows the existing pattern (`dialog.tsx`, `button.tsx`, etc.) and keeps the dark-themed styling centralized.

### LanguageCombobox icon prop

The existing `LanguageCombobox` hardcodes a `Languages` (lucide) icon. The subtitle dropdown needs a closed-caption icon (e.g., `Captions` from lucide). Adding an optional `icon` prop avoids duplicating the component while keeping the current usage unchanged (defaults to `Languages`).

---

## Implementation Units

### U1. GraphQL fragment extension + subtitle types

**Goal:** Fetch subtitle data from admin and make it available as typed data in the content layer.

**Requirements:** R8

**Dependencies:** None

**Files:**

- `apps/web/src/lib/fragments/watch-video.ts` (modify)
- `apps/web/src/lib/content.ts` (modify)

**Approach:**

Extend the `variants: dubs` selection in `watchVideoFragment` to traverse `videoEdition { subtitles { ... } }`:

```
videoEdition {
  subtitles {
    id
    language { slug name bcp47 }
    vttSrc
    primary
    aiGenerated
  }
}
```

After extending the fragment, run `pnpm --filter @forge/admin-graphql generate` to regenerate the introspection types.

In `content.ts`, add a `WatchSubtitle` type:

- `id: string`
- `language: { slug: string; name: string; bcp47: string }`
- `vttSrc: string`
- `primary: boolean`
- `aiGenerated: boolean` (fetched per R8; no UI use yet — available for future quality indicators)

Add `subtitles: WatchSubtitle[]` to `WatchVideoRecord`. During normalization, extract subtitles from the selected variant's `videoEdition.subtitles` (not the first variant — different editions may have different subtitle sets, since timecodes are per-cut). Filter to only entries with a non-null `vttSrc`, deduplicate by language slug, and sort alphabetically by language name.

**Patterns to follow:**

- Existing `variants: dubs` alias pattern in `watchVideoFragment`
- Type anchoring via `AdminFragmentOf<typeof fragment>` (see `docs/solutions/logic-errors/gql-tada-fragment-anchor-cast-drift-same-fragment-multi-query-20260514.md`)
- Existing `WatchVariant` type structure in `content.ts`

**Test scenarios:**

- Video with subtitles: `WatchVideoRecord.subtitles` populated with correct language/vttSrc data
- Video with no subtitles: `WatchVideoRecord.subtitles` is empty array
- Subtitles with null `vttSrc` are filtered out
- Subtitles are deduplicated by language slug across multiple variants sharing the same edition
- Subtitles are sorted alphabetically by language name

**Verification:** `pnpm --filter @forge/admin-graphql generate` succeeds without drift. TypeScript compiles cleanly. The subtitle data flows through to `WatchVideoRecord` in the resolver output.

---

### U2. Subtitle preference persistence

**Goal:** Client-side cookie helpers for reading and writing subtitle on/off + language preference.

**Requirements:** R5, R6

**Dependencies:** None

**Files:**

- `apps/web/src/lib/subtitle-preference-client.ts` (create)
- `apps/web/src/lib/subtitle-preference-client.test.ts` (create)

**Approach:**

Create two helpers following the `language-preference-client.ts` pattern:

- `writeSubtitlePreference(enabled: boolean, languageSlug: string | null)` — writes a cookie `forge_watch_subs` with value `off` or the language slug. Uses `document.cookie` with `path=/watch; max-age=31536000; samesite=lax` (+ `; secure` in production). Guards `typeof document === "undefined"`.
- `readSubtitlePreference(): { enabled: boolean; languageSlug: string | null }` — reads from `document.cookie`. Returns `{ enabled: false, languageSlug: null }` when no cookie exists or value is `off`. Otherwise returns `{ enabled: true, languageSlug: <value> }`.

Cookie name constant exported from a constants file or inline (low reuse risk — inline is fine).

The fallback logic for unavailable languages (R5 fallback chain, R6 default) lives in the consuming component (U5), not in the persistence layer. The persistence layer is a pure read/write of the raw preference.

**Patterns to follow:**

- `apps/web/src/lib/language-preference-client.ts` — client-side cookie write pattern
- `apps/web/src/lib/language-preference-constants.ts` — cookie name constant pattern
- `apps/web/src/lib/language-preference.test.ts` — contract tests for cookie parsing

**Test scenarios:**

- Write enabled + language slug, read it back correctly
- Write disabled, read back `{ enabled: false, languageSlug: null }`
- No cookie set: returns `{ enabled: false, languageSlug: null }`
- Cookie with URL-encoded slug (e.g., `zh%20hant`) decodes correctly
- SSR guard: write is no-op when `typeof document === "undefined"`
- Overwriting an existing preference replaces the old value

**Verification:** All tests pass. Cookie format matches the existing language preference pattern.

---

### U3. Switch UI component

**Goal:** Reusable toggle switch component wrapping `@base-ui/react/switch`.

**Requirements:** R2

**Dependencies:** None

**Files:**

- `apps/web/src/components/ui/switch.tsx` (create)

**Approach:**

Thin wrapper around `@base-ui/react/switch` following the existing `dialog.tsx` / `button.tsx` pattern. Exports `Switch` component with props:

- `checked: boolean`
- `onCheckedChange: (checked: boolean) => void`
- `disabled?: boolean`
- Standard `className`, `aria-label`, etc.

Style with Tailwind for the dark stone theme: stone-700 track when off, white/stone-100 thumb, primary color track when on. Transition for the thumb slide.

**Patterns to follow:**

- `apps/web/src/components/ui/dialog.tsx` — base-ui wrapper pattern
- `apps/web/src/components/ui/button.tsx` — variant/className merging pattern

**Test scenarios:**

Test expectation: none — pure styling wrapper with no behavioral logic beyond what base-ui provides. Visual verification via browser screenshot.

**Verification:** Renders correctly in the language picker modal (verified visually in U4).

---

### U4. Language picker modal subtitle section

**Goal:** Add the subtitle controls UI (toggle + language dropdown) to the existing language picker modal.

**Requirements:** R1, R2, R3, R4

**Dependencies:** U2, U3

**Files:**

- `apps/web/src/components/watch/LanguagePickerModal.tsx` (modify)
- `apps/web/src/components/watch/LanguageCombobox.tsx` (modify)
- `apps/web/src/components/watch/LanguagePickerModal.test.tsx` (modify — if exists, otherwise create)

**Approach:**

**LanguageCombobox icon prop:** Add an optional `icon?: LucideIcon` prop defaulting to `Languages`. The trigger button renders this prop instead of the hardcoded `Languages` icon. Zero change to existing call sites.

**LanguagePickerModal changes:**

Add new props:

- `subtitles: WatchSubtitle[]` — available subtitle tracks for this video
- `currentSubtitleEnabled: boolean` — current applied subtitle state
- `currentSubtitleSlug: string | null` — current applied subtitle language
- `onSubtitleChange?: (enabled: boolean, languageSlug: string | null) => void` — callback on Apply

Add draft state for subtitles (mirrors the existing `draftSlug` pattern):

- `draftSubtitleEnabled: boolean` — initialized from `currentSubtitleEnabled` on dialog open
- `draftSubtitleSlug: string | null` — initialized from `currentSubtitleSlug` on dialog open

**Subtitle section layout** (below the Language section, above the footer buttons):

- Header row: "Subtitles" label + `<Switch>` toggle + `"{N} languages"` count
- `<LanguageCombobox icon={Captions}>` below, disabled when toggle is off (via `pointer-events-none opacity-50` wrapper)
- Entire section hidden when `subtitles.length === 0`

**Apply button — split path for subtitle-only vs. language changes:**

`isDirty` now considers both language AND subtitle changes. `handleApply` has two paths:

- **Language changed** (with or without subtitle changes): calls `onSubtitleChange` first, then `router.push` for the language navigation + `onClose()` (existing behavior).
- **Subtitle-only change** (language unchanged): calls `onSubtitleChange` and `onClose()` — does NOT call `router.push`. A navigation for subtitle-only changes would cause a full page re-render and interrupt playback, which destroys the user's watching experience.

**Close button:** Discards both draft language and draft subtitle state (existing behavior — state resets on dialog open).

**Patterns to follow:**

- Existing `draftSlug` / `isDirty` / `handleApply` pattern in `LanguagePickerModal.tsx`
- `LanguageCombobox` controlled-component pattern
- `deriveLanguageDisplay` for subtitle language display names

**Test scenarios:**

- Modal with subtitles: subtitle section visible with correct language count
- Modal without subtitles: subtitle section hidden, modal looks identical to current behavior
- Toggle off: subtitle combobox is visually disabled
- Toggle on: subtitle combobox is interactive, shows available languages
- Select subtitle language: Apply button becomes enabled (dirty state)
- Toggle subtitles on without changing language: Apply button becomes enabled
- Apply with language change: triggers navigation + subtitle callback
- Apply with subtitle-only change: triggers subtitle callback only, no navigation, no playback interruption
- Close discards pending subtitle changes
- Re-opening modal resets draft subtitle state to current applied state
- Keyboard navigation: Switch is focusable and toggleable via Space/Enter
- Screen reader: Switch has accessible label "Subtitles"

**Verification:** Modal matches the reference screenshot layout. Toggle + dropdown + Apply all work together. No regression in language-only behavior.

---

### U5. Subtitle state coordination + VTT track rendering

**Goal:** Wire subtitle state through WatchPageClient and render VTT tracks on the Mux Player.

**Requirements:** R5, R6, R7

**Dependencies:** U1, U2, U4

**Files:**

- `apps/web/src/components/watch/WatchPageClient.tsx` (modify)
- `apps/web/src/components/watch/HeroPlayer.tsx` (modify)
- `apps/web/src/components/watch/HeroPlayerControls.tsx` (modify — if subtitle indicator needed)

**Approach:**

**WatchPageClient subtitle state:**

Add state for the active subtitle preference:

- `subtitleEnabled: boolean`
- `subtitleSlug: string | null`
- `subtitleVttSrc: string | null` (derived from subtitleSlug + video.subtitles)

On mount (`useEffect`), read `readSubtitlePreference()` from U2. Two distinct scenarios:

**R5 — Returning user with persisted preference:** Cookie has `enabled=true` + a language slug.

1. If persisted slug matches an available subtitle → use it
2. Else if a subtitle matches the current audio language → use it
3. Else if a subtitle has `primary: true` → use it
4. Else → use the first available subtitle
5. If no subtitles exist at all → `subtitleEnabled: false`

Do NOT update the cookie on fallback — the cookie represents the user's explicit preference. Only write the cookie when the user explicitly applies via the modal.

**R6 — First-time enable (no persisted preference):** Cookie absent or `off`. When the user first toggles subtitles on in the modal, the default language is the one matching the current audio language (the selected dub). If no match, fall back to `primary: true`, then first available.

Pass to `LanguagePickerModal`: `subtitles`, `currentSubtitleEnabled`, `currentSubtitleSlug`, and `onSubtitleChange` callback. The callback:

1. Updates local state
2. Calls `writeSubtitlePreference(enabled, slug)`
3. Derives the `vttSrc` from the selected slug

**Cookie value on toggle off:** `writeSubtitlePreference(false, null)` writes `off`. The previous language slug is lost. When the user toggles back on, R6's first-time logic applies (default to audio language match).

Pass to `HeroPlayer`: `subtitleVttSrc` (string | null) — null means no active subtitle.

**HeroPlayer VTT rendering:**

Accept a new `subtitleVttSrc: string | null` prop. Try `<track>` children of `<MuxPlayer>` first — if Mux Player forwards them to its internal `<video>` in the shadow DOM, this is the simplest path:

```html
<track kind="subtitles" src="{subtitleVttSrc}" default />
```

If `<track>` children don't render captions (Mux's shadow DOM may not forward them), fall back to the imperative `textTracks` API on the player ref: use `addTextTrack()` or manipulate `textTracks[i].mode = "showing"`. The MuxPlayerSpike test confirms `ref.current.textTracks` is accessible and documents the `textTracks.addEventListener('change', ...)` pattern for caption state monitoring.

When `subtitleVttSrc` changes (language switch or toggle), update the active track. When null, remove or hide any active text track.

**Subtitle display during muted autoloop:** Show subtitles during the pre-reveal muted loop phase if the user has a persisted preference for subtitles on. The text provides value even when audio is muted (same dialogue). First-time visitors with no preference see no subtitles until they enable them.

Subscribe to the `textTracks` `change` event to sync local React state (but NOT the cookie) if the user interacts with native controls in iOS fullscreen. The cookie represents the user's explicit modal preference; native control changes are transient overrides.

**React Compiler compliance:** Mutate `textTracks[i].mode` through `playerRef.current`, not through the state-held `player` (see `docs/solutions/design-patterns/react-compiler-ref-and-setstate-patterns-20260513.md`).

**Patterns to follow:**

- `docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md` — custom chrome event subscription pattern
- `docs/solutions/design-patterns/react-compiler-ref-and-setstate-patterns-20260513.md` — ref mutation patterns
- MuxPlayerSpike test `textTracks.addEventListener('change', ...)` pattern
- Existing `variantsForLanguagePicker` construction in WatchPageClient

**Test scenarios:**

- Video with subtitles + preference enabled: VTT track renders on player
- Video with subtitles + preference disabled: no track on player
- Video without subtitles: no track, no subtitle state, no errors
- Toggling subtitles on via modal: track appears on player
- Toggling subtitles off via modal: track removed from player
- Changing subtitle language via modal: track src updates
- Language switch (dub change via navigation): subtitle state persists, track re-renders with correct VTT for new video
- Persisted subtitle language unavailable for new video: falls back to audio language match, then primary, then first available
- No persisted preference: subtitles default to off
- First-time enable (no persisted preference): defaults to current audio language's subtitle
- Toggle off then back on: defaults to audio language match (previous slug not preserved)
- Cookie written on Apply: reloading page restores subtitle state
- Subtitles display during muted autoloop when persisted preference is on

**Verification:** Subtitles display over the video in the correct language. Toggling on/off works. Preference survives page navigation and browser reload. Videos without subtitles show no errors or UI artifacts.

---

## System-Wide Impact

- **GraphQL fragment size:** Adding `videoEdition.subtitles` to `watchVideoFragment` increases the query payload. For videos with many subtitle languages, this could be meaningful. The data is only fetched for video detail pages (not list/search), so the impact is bounded.
- **Admin codegen:** Running `pnpm --filter @forge/admin-graphql generate` regenerates the introspection types. This generated file must be committed alongside the fragment change.
- **No server-side impact:** Subtitle preference is entirely client-side. No middleware changes, no ISR invalidation concerns, no new server-side cookies.
- **No admin changes:** Admin's schema already exposes `VideoEdition.subtitles` with all needed fields.

---

## Risks and Mitigations

| Risk                                                                    | Mitigation                                                                                                                                         |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Some videos have subtitles with null `vttSrc`                           | Filter in normalization layer — only include subtitles with valid VTT URLs                                                                         |
| Mux Player `<track>` children may not forward through shadow DOM        | Try `<track>` first; fall back to imperative `textTracks` API (`addTextTrack` + `mode = "showing"`) — the spike test confirms the API is available |
| iOS fullscreen uses native `<video>` controls with its own caption menu | Accept for now — users can use either the native menu or the language picker modal. Document as a known quirk                                      |
| Large subtitle file loading delay                                       | VTT files are typically small (tens of KB). No preloading needed for initial implementation                                                        |

---

## Deferred Implementation Notes

- Exact `@base-ui/react/switch` API shape — consult docs at implementation time
- Mux Player's exact behavior when `<track>` children change dynamically — verify in browser during implementation
- Whether `textTracks` `change` event fires reliably across browsers when switching `<track>` src — test and adapt

---
date: 2026-04-24
topic: tv-search-ui
---

# TV App — Search UI (feat-106 UX requirements)

## Problem Frame

The TV app has no way to search. Users can only discover Experiences through the home rail, so anyone who knows what they want to watch must scroll and hope. Web and mobile both shipped search; TV is the only surface without it.

The `feat-106` ticket commits to a full-screen `/search` route with an on-screen keyboard and results grid, and wires the existing `semanticSearch` GraphQL operation. What the ticket does **not** specify is the UX: how prominent the entry point is, what the screen looks like before typing, how the keyboard is laid out, and which input methods beyond on-screen tapping are supported.

This document locks those product decisions so planning can proceed without inventing user behavior. Implementation detail (file paths, types) lives in `docs/roadmap/topic-experiences/feat-106-tv-app-search-ui.md` and will need a duration revision to reflect the expanded scope captured below.

TV's ergonomic reality shapes every decision: remote-control typing is slow and uncomfortable, so the highest-leverage UX move is to **let users avoid typing most of the time**. Every major decision in this document is measured against that constraint.

---

## Key Flows

- F1. **Discover via category card (typing-free)**
  - **Trigger:** User opens search and recognises a topic in the Browse row.
  - **Actors:** A1.
  - **Steps:** From home, D-pad up to the top-left Search chip → press center → lands on `/search` with keyboard focused by default → D-pad right into the category row → select card (e.g., "Parables") → results grid replaces the browse pane.
  - **Outcome:** Results for the category's `searchTerm` are rendered and first result is focused.
  - **Covered by:** R1, R2, R5, R6, R10.

- F2. **Discover via on-screen keyboard**
  - **Trigger:** User has a specific title/topic in mind.
  - **Actors:** A1.
  - **Steps:** Enter `/search` → D-pad to letters in the frequency top row or alphabetical grid → each press appends to query → after 600 ms idle (or explicit ⏎) results fire → D-pad down past the keyboard lands focus on the first result.
  - **Outcome:** Query is run, results rendered, focus delegated to results grid.
  - **Covered by:** R3, R4, R7, R10, R11.

- F3. **Discover via phone or hardware keyboard**
  - **Trigger:** User has the Apple TV Remote iOS app, Google TV app, or a Bluetooth keyboard paired.
  - **Actors:** A1, A2.
  - **Steps:** User starts typing on their phone/keyboard → characters are routed through the hidden TextInput → query field updates in real time → results fire identically to F2.
  - **Outcome:** User types at keyboard speed without touching the TV remote.
  - **Covered by:** R8, R9.

- F4. **Discover via voice / dictation**
  - **Trigger:** User holds the Siri button on Apple TV remote or the Google Assistant button on Android TV remote while the search screen is active.
  - **Actors:** A1, A3.
  - **Steps:** User speaks query → platform dictation transcribes into the query field → results fire automatically on transcription end.
  - **Outcome:** Zero keyboard presses; user speaks and watches.
  - **Covered by:** R12, R13. (Phased rollout — see Dependencies / Assumptions.)

- F5. **Re-run a recent query**
  - **Trigger:** User returns to search after submitting at least one non-empty query in the past.
  - **Actors:** A1.
  - **Steps:** Enter `/search` → D-pad right/up to the Recent row above Browse topics → select a past query card → that query re-runs and results render.
  - **Outcome:** User replays prior searches without retyping.
  - **Covered by:** R14, R15.

- F6. **Exit and return**
  - **Trigger:** User presses Back/Menu on remote, or navigates into a result and back.
  - **Actors:** A1.
  - **Steps:** Back → pops to home → focus restored to the Search chip so D-pad-up from the rail still lands there naturally.
  - **Outcome:** Search is reversible without losing orientation; history persists across visits.
  - **Covered by:** R16.

---

## Actors

- A1. **TV viewer (primary):** Uses a D-pad remote (Siri Remote on tvOS, Android TV remote on Android TV). Browsing-first; types only when necessary.
- A2. **TV viewer with companion device:** Has Apple TV Remote iPhone app, Google TV phone app, or a paired Bluetooth keyboard. Prefers to type at phone/keyboard speed.
- A3. **TV viewer using voice assistant:** Invokes Siri (tvOS) or Google Assistant (Android TV) via the remote's dedicated voice button to dictate a query.

---

## Requirements

**Entry point and navigation**

- R1. The TV home screen renders a persistent, focusable Search affordance in the top-left header area above the `HomeHero`. It is visible on every render of `index.tsx`, does not scroll with the experiences rail, and is reachable via D-pad-up from any card in the Experiences rail.
- R2. Activating the Search affordance navigates to the `/search` route. The Search affordance visually mirrors the Crimson Gallery chip style (surface container background, crimson focus glow on focus) and displays a magnifier icon plus the label "Search".
- R16. Back/Menu on the `/search` route pops navigation to home and restores focus to the Search chip on home. Focus restoration uses the `hasTVPreferredFocus` workaround noted in `apps/tv/CLAUDE.md` for tvos issue #852.

**Search screen layout**

- R3. `/search` renders a two-pane layout: a **left input pane** (keyboard + query display) and a **right content pane** (pre-search surface or results grid). Both panes fill the viewport side-by-side. On Android TV the pane ratio mirrors tvOS to keep a single design.
- R4. The query display (text the user has typed so far) sits at the top of the left pane above the keyboard, with placeholder copy "Type to search" when empty. A visible cursor position is shown. Backspace, submit, and dictation can all modify it.

**On-screen keyboard**

- R5. The on-screen keyboard uses an **alphabetical grid with a frequency top row**: the top row contains the 7 most common English letters in descending frequency order (E T A O I N S) as a quick-pick row; the rows below are A–Z in alphabetical order across 4 rows of 7. Numerals 0–9, space, apostrophe, period, and backspace appear in the bottom rows. The frequency row does NOT exclude letters from the alphabetical grid below — letters are reachable in two places, and the alphabetical grid remains the predictable fallback for viewers who don't want to learn the shortcut.
- R6. Each key is a `FocusableCard` with the standard Crimson Gallery focus scale + glow. `TVFocusGuideView` traps horizontal D-pad navigation within the keyboard grid; D-pad-right from the keyboard's right edge crosses into the right pane; D-pad-down from the keyboard's bottom row crosses into the right pane (jumping to the first results card or the first browse card, whichever is rendered).
- R7. Key press behavior: letter/numeral keys append to the query, backspace removes the last character, space inserts a space, and a dedicated Search (⏎) key submits the query immediately regardless of the idle debounce. Keys are press-only; no press-and-hold behavior in v1 (no key repeat, no capitalisation toggle — queries are case-insensitive on the semantic search backend).

**Query submission**

- R10. The query submits automatically after 600 ms of no input changes, OR immediately on ⏎ press, OR immediately on dictation end. Empty queries are a no-op (no network call). Any in-flight query is cancelled when a new submit fires. The 600 ms debounce is deliberately longer than web's 300 ms because remote typing is slower and we want fewer round trips.
- R11. Successful result land moves focus from the keyboard's most-recently-pressed key to the first results card. If the user was navigating the browse / recent / popular surfaces when results landed (e.g., dictation completed while focus was on a category), focus stays where it is — the results render silently and the user discovers them via D-pad down.

**Alternate input methods**

- R8. A hidden, always-focused `<TextInput>` is mounted on the `/search` route to receive input routed by (a) paired Bluetooth keyboards and (b) the Apple TV Remote iOS app and Google TV phone app. Its `onChangeText` is the single write path into the `query` state for all non-on-screen-keyboard sources. The on-screen keyboard writes to the same `query` state so the display and results stay synchronised across input methods. This requirement intentionally overrides `feat-106`'s "no `<TextInput>` fallback" constraint; planning must verify the hidden-input routing works reliably on both `react-native-tvos` platforms before merging.
- R9. Bluetooth keyboard input additionally supports the native keyboard's `Enter` key as ⏎ and `Backspace` as the backspace key. No further key remapping is required in v1.
- R12. The Siri button on Apple TV remotes and the Google Assistant button on Android TV remotes trigger platform dictation. Dictated text is written into the query via R8's hidden TextInput (or an equivalent native bridge), and the submit fires on dictation-end signal. Dictation must not require the user to re-press the Search chip — activating the platform voice button anywhere on `/search` engages dictation.
- R13. Dictation is a best-effort v2 capability inside feat-106 and may ship in a phased PR after the non-dictation flows land. See Dependencies / Assumptions for the native-module risk and the phased-PR plan.

**Pre-search content surface (right pane when query is empty)**

- R17. Before any query is typed, the right pane renders three stacked sections in this order:
  1. **Recent searches** (rendered only when non-empty) — horizontal rail of up to 5 past-query chips.
  2. **Browse topics** — horizontal row of 6 category cards ported verbatim from web's `FloatingSearchBar` categories (Bible Stories, Parables, Animated, Study, Family, Christmas). Each card is a `FocusableCard` with a gradient background rendered via `expo-linear-gradient`, a title, and a focus state matching the Crimson Gallery.
  3. **Popular experiences** — horizontal rail reusing data already fetched by `LIST_EXPERIENCES` on home so we don't issue a second network request. The rail shows the first N experiences and follows the same `ContentRail` layout as home.
- R18. Activating a category card calls `setQuery(card.searchTerm)` and fires `semanticSearch` immediately (bypassing the 600 ms debounce). The card's `searchTerm` is visible in the query display so the user understands what was searched.
- R19. Activating a popular-experience card navigates directly to `/experience/[slug]` — bypassing search entirely, because the user has already made a concrete choice.
- R20. When the query is non-empty, the three pre-search sections are replaced by the results grid via a cross-fade transition. The pre-search sections return when the query is cleared to empty (via backspace, selecting a recent query, or closing and reopening the search screen).

**Recent searches**

- R14. Recent searches are persisted locally via `@react-native-async-storage/async-storage` under the key `tv.searchHistory.v1`. Only successful non-empty submits that returned ≥ 1 result are recorded. Duplicates move to the front of the list instead of appending; the list is capped at 5 entries.
- R15. A "Clear history" affordance appears at the right end of the Recent row and empties the stored list. Individual entries cannot be deleted in v1 (intentional simplification — overflow to a per-entry delete if users ask).

**Results grid**

- R21. Results render in a grid reusing the home rail card's visual language (image + title, Crimson Gallery surface container). Grid dimensions: 4 columns on 1080p and 6 columns on 4K, sized via `scale()` per `apps/tv/CLAUDE.md`. No explicit page scroll affordance in v1 — vertical D-pad scrolls the whole screen.
- R22. Empty state (query returns zero results): centered message "No results for '<query>'". Focus returns to the keyboard so the user can edit the query.
- R23. Loading state: `ActivityIndicator` in the right pane. The keyboard remains interactive during loading so users can keep typing to refine the query.
- R24. Error state: centered message "Search is temporarily unavailable" plus a focusable Retry button. Retry re-fires the last query.

**Result selection**

- R25. Selecting a result navigates to `/experience/[slug]` via `router.push`. If the result's shape includes a `playbackId` + `startSeconds` (scene-level match), the experience screen is expected to open playback and seek to that time — the seek behavior is owned by `feat-076` and is not re-specified here.

**Styling and design system**

- R26. All colors come from `apps/tv/src/lib/colors.ts`; no hardcoded hex values. The Crimson Gallery palette applies: `#161311` background, `#221F1D` surface container, `#CB333B` crimson for CTAs and focus rings, `#F5F5F4` text, `#A8A29E` muted.
- R27. All dimensions use `scale()` from `apps/tv/src/lib/scale.ts`. All font sizes on Android are rounded via `Math.round()` to avoid sub-pixel blurring (per `apps/tv/CLAUDE.md` pitfall list).
- R28. Focus states use the standard Crimson Gallery treatment: `transform: [{ scale: 1.05 }]` + crimson-tinted shadow. No 1 px borders — only background-color shifts and shadow-based focus indication.
- R29. `locale` is hardcoded to `"en"` via `getLocale()` in `apps/tv/src/lib/config.ts` (consistent with `feat-106`'s existing constraint). feat-109 is the correct place to swap this to a dynamic value; feat-106 ships reading from the helper so the swap is a one-line change.

---

## Success Criteria

- A TV viewer on the home screen can reach search in one deliberate D-pad gesture (up, then center).
- From `/search`, a viewer who does not know what they want can find and open an experience via category cards or popular rail without pressing any letter key.
- From `/search`, a viewer who knows what they want can type a query on the on-screen keyboard, Bluetooth keyboard, companion phone app, or by speaking, and reach results that match what web returns for the same query at `locale: "en"`.
- A query the viewer submitted previously appears in the Recent row on their next visit to `/search`, and re-running it takes one press.
- Results land with focus on the first result; the viewer does not need to scroll to discover that results are ready.
- Back from `/search` returns the viewer to home with focus on the Search chip, so repeated search visits feel continuous.
- Implementation passes `pnpm --filter tv typecheck` and `pnpm --filter tv test`, the on-screen keyboard renders identically on Apple TV Simulator and Android TV emulator, and at least one end-to-end pass of F1–F3 has been verified on hardware (or a near-hardware simulator) for each platform.
- A downstream implementer reading `feat-106` plus this document has enough to begin planning without asking follow-up product questions; the only remaining questions are in "Outstanding Questions → Deferred to Planning".

---

## Scope Boundaries

- No pagination ("Load more") or infinite scroll in v1 — results are whatever the backend returns in one call. Adding pagination is a follow-up if the backend's default limit proves too small in practice.
- No filters, sort order, or result-type toggles (experiences vs. scenes vs. topics). Results render in backend-supplied score order.
- No search analytics / tracking in v1. A hook point should be easy to add later but is not specified here.
- No language selector; `locale: "en"` stays hardcoded until feat-109 (`localization-ui-tv`) ships.
- No individual recent-search deletion in v1 — only full "Clear history".
- No trending / popular-search term pills. "Popular experiences" is experience-level only and reuses the existing home query.
- No personalisation of categories, popular, or recent surfaces. Everything is either hardcoded (categories) or derived from on-device state (recent) or the global home query (popular).
- Scene-timestamp seek on result tap stays out of scope for feat-106 itself and is delegated to the existing `feat-076` video-player work.
- No changes to `apps/web`, `apps/mobile`, `apps/cms`, or `packages/graphql`. The `semanticSearch` GraphQL op is already defined; the TV app declares its own typed copy of it per the `packages/graphql` pattern.

---

## Key Decisions

- **Entry point is a persistent top-left chip, not a rail tile.** TV viewers expect search to live at the top-left of every TV app (Netflix, Disney+, Apple TV, HBO). A chip outside the rail doesn't compete with rail focus and is reachable via D-pad-up from any card.
- **Keyboard layout is alphabetical + frequency top row.** Alphabetical is the conventional TV expectation (Netflix pattern). A frequency row above it captures typing-speed wins for English without penalising viewers who don't spot the shortcut — they still have A–Z below, exactly where they expect.
- **Pre-search surface is browse-first.** Three typing-free paths (recent, categories, popular) sit next to the keyboard. On TV the browse-first assumption is stronger than on web; we expect the majority of sessions to never touch the keyboard.
- **Four input methods ship together.** On-screen keyboard + Bluetooth keyboard + companion-app keyboard + Siri/Google dictation. The hidden `<TextInput>` is the single entry point for external input and overrides `feat-106`'s original "no `<TextInput>` fallback" rule because excluding Remote-app and BT keyboard input would be a material UX regression relative to the web and mobile surfaces.
- **Dictation is phased within feat-106.** User preference is to keep dictation inside the same ticket. To preserve shippability, dictation lands in a follow-up PR within feat-106 (R13) so the non-dictation UX does not block on native-module work.
- **No search history deletion UX beyond "Clear all" in v1.** Per-entry delete is a small addition if viewers ask for it.
- **Popular rail reuses home's `LIST_EXPERIENCES` query.** No new Strapi content type, no new GraphQL op. If "popular" diverges meaningfully from "first in home rail" later, that becomes its own ticket.

---

## Dependencies / Assumptions

- **New dependency: `@react-native-async-storage/async-storage`** is not currently installed in `apps/tv/package.json`. Planning must add it for R14; expo-managed workflow compatibility is assumed (it's the community standard and supported on `react-native-tvos`).
- **Existing dependency: `expo-linear-gradient`** is already in `apps/tv/package.json` (v55.0.13), so category card gradients require no new install.
- **Existing GraphQL backend: `semanticSearch`** resolver exists and returns the shape documented in `feat-106`. This document assumes that shape is stable through feat-106's ship date.
- **`popularExperiences` is not a real backend concept** yet. R17 reuses the home rail's data — an explicit shortcut. If a dedicated popularity signal is later added, that's a separate ticket.
- **`feat-076` owns video-seek-on-scene-match behavior.** This doc references it for R25 completeness but does not re-specify it.
- **Expanded scope vs. ticket duration.** `feat-106`'s current `duration: 2` is accurate for the ticket-as-originally-written. The scope captured here (categories + popular + recent + BT + companion-app + dictation) is honestly closer to **10–14 days** of focused work. Planning should either revise `feat-106`'s `duration` field alongside `start_date`, or explicitly phase the rollout into sub-PRs (keyboard + categories → companion/BT input → recent → dictation). The author's preference was to keep a single ticket; phasing inside the single ticket preserves that preference.
- **tvOS hidden-TextInput routing is unverified against this codebase.** There is no prior art in `apps/tv` for hidden-TextInput-backed input routing. `react-native-tvos` historically had rough edges around focused-but-invisible text inputs (visibility, focus rings, remote-app hand-off). Planning must prove this works on tvOS and Android TV before committing to R8.
- **Native module work for dictation is novel in this repo.** Neither `apps/tv` nor `apps/mobile` currently exposes Siri dictation or Google Assistant intents. Planning should scope the native work separately (Expo config plugin vs. custom native module) before accepting R12/R13's ship date.

---

## Outstanding Questions

### Resolve Before Planning

(None — all product-level decisions are locked above.)

### Deferred to Planning

- [Affects R8][Technical][Needs research] Does a focused-but-visually-hidden `<TextInput>` reliably receive Apple TV Remote app and Google TV app keystrokes on current `react-native-tvos`? If not, we need a native module for both platforms — which meaningfully changes timeline estimates. Planning should build a 30-minute spike on the Apple TV simulator and Android TV emulator before committing.
- [Affects R12, R13][Technical][Needs research] What is the least-invasive way to invoke Siri dictation on tvOS and Google Assistant dictation on Android TV from an Expo custom dev client? Candidates: Expo config plugin, `expo-modules` custom native module, or first-party platform SDK hook. Planning should decide before writing any native code.
- [Affects R11][Technical] Exact focus-restoration mechanism when dictation-end lands while the user is not focused on the keyboard — how do we detect the "user is elsewhere" condition deterministically, and what does "silently render" look like in practice? Likely small; deferring to planning.
- [Affects R21][Technical] Optimal grid column count for 4K tvOS vs. 1080p Android TV, given actual `scale()` output on both. Planning validates on simulator/emulator and picks the final numbers.
- [Affects R5][Technical] Should the frequency top row letters be visually de-emphasised (smaller) or emphasised (highlighted) relative to the alphabetical grid below? This is a design-system-polish detail; defer to the planning/design iteration loop.
- [Affects all][Technical] Should feat-106 be phased into multiple PRs inside one roadmap ticket (keyboard+categories → companion-app routing → recent → dictation), or a single large PR? Planning makes this call based on review bandwidth and risk tolerance.

---

## Next Steps

- Update `docs/roadmap/topic-experiences/feat-106-tv-app-search-ui.md` — revise `duration` to reflect the expanded scope, add a reference to this brainstorm, and soften the "no `<TextInput>` fallback" constraint to match R8.
- `/ce-plan` for structured implementation planning once the roadmap ticket is synchronised. Planning should open with the two unresolved technical spikes (hidden-TextInput routing; dictation native-module path) because they gate time estimates.

# TV App Architecture Review — Findings Handoff

Date: 2026-07-11, evidence re-verified 2026-07-12 after #1526 (home parity U3–U9) landed on main at `034b14b6`.

This is the durable record of an `/improve-codebase-architecture` review of `apps/tv` (~27.9k lines). Three parallel Explore sweeps covered the data layer, the player/screens/session topology, and the focus-UI/renderer surface. The HTML report this summarizes was a session-scratch artifact and is gone; everything load-bearing is here.

## How to use this doc

- These are **candidates, not committed work**. The intended flow per candidate: pick → run `/grilling` to walk the design with the owner → produce a `docs/plans/` plan or a `feat-NNN` roadmap ticket. Do not implement straight from this doc.
- The vocabulary (module, interface, depth, seam, adapter, leverage, locality, deletion test) is from `.claude/skills/codebase-design/SKILL.md`. Read it first; the candidates are phrased in its terms.
- Line numbers were exact on 2026-07-12. Re-verify with the grep patterns given per candidate before acting; prefer the symbol names over the line numbers.

## Implementation status (2026-07-12, end of day)

> **Update (2026-07-17):** no longer local-only — this branch was squash-merged to main as PR #1532 (`a87e46e4`, 2026-07-13), including a post-review fix commit beyond `0a746597`; the worktree is gone and the local branch is safe to delete. Live remainder: candidate 4's tail (player adapter seam, `menuLatchedRef`, replaceAsync orchestration), candidate 5's deferred extractions, and candidate 8.

Branch `chore/tv-focus-visual-module` (worktree `.claude/worktrees/tv-focus-visual-module`, local only, not pushed; 9 commits `4a8bbfbc..0a746597`). All verified per commit: typecheck + lint + 633 tests green; tvOS sim smoke across home/search/series/watch (card rings, key invert, pill glow, series ThumbRail, watch below-fold typed sections, question expansion, search browse).

- **Candidate 1 — DONE** (both tranches): `src/components/focus/` module with 9 role presets; both engines absorbed; `watch/useFocusAnimation.ts` deleted; all ~25 consumers migrated; ring unified at 0.9; retry one-offs collapsed onto shared `RetryButton`.
- **Dead code — DONE**: all six deletion-test items removed (−264 lines); `titleVariants` went with `resolveFeaturedTitle`.
- **Candidate 2 — DONE (scoped)**: `rails/ThumbCard` + `rails/ThumbRail` merge the duplicate episode cards/rails (Up Next gained `getItemLayout` + a RUM action name). Deliberate boundary: HomeRail/HomeCard keep their Home-specific windowing (deep-not-wide); SDUI rails left to the restyle plan.
- **Candidate 3 — DONE (SDUI half)**: normalizer emits a ResultOf-derived discriminated union; renderers take typed models, zero `as` casts; fixed four latent never-fetched reads (navHeading, videoRef/video, item.video branches, RelatedQuestions id-keyed expansion). Search half deliberately skipped — already end-to-end typed via ResultOf.
- **Candidate 7 — DONE**: `lib/cardImage.ts` with poster/card intents; third picker (+`lib/types.ts`) deleted; query documents untouched (lean-payload law).
- **Candidate 6 — DONE**: `ScreenStateView` adopted by home/series/watch/Experience/search-grid. Deliberate convergence: watch's retry pill moved Crimson → WATCH accent.
- **Candidate 4 — first slice DONE**: the four `ensureActiveVariantMedia` triggers collapsed to one provider-owned effect (active dub's ~5KB media loads on dub resolve). **Remaining**: player adapter seam, `menuLatchedRef` elimination, replaceAsync orchestration — needs a dedicated dub-switch device session (birth-of-jesus flow, cold-relaunch discipline per the zombie-player note).
- **Candidate 5 — DEFERRED with recipes**: the machine extractions (useWatchHome loader with injected fetch/storage/clock; search debounce machine; Chrome auto-hide) were not attempted: useWatchHome was rewritten+sim-verified in #1526 the same day (churning it again without SWR device verification would trade verified reliability for testability), and the Chrome machine is device-only verifiable. Resume: extract `createWatchHomeLoader(deps)` next time the hook changes for feature reasons; pair the Chrome machine with a player-session sim day.
- **Candidate 8 — NOT ATTEMPTED** (cross-app): needs its own scoping conversation with mobile in the room.

## Standing decisions (do not re-litigate)

1. `docs/plans/2026-07-08-003-feat-tv-home-experience-parity-plan.md` — U3–U9 **shipped 2026-07-12 as PR #1526**; `docs/roadmap/topic-experiences/feat-246-tv-home-experience-content-parity.md` tracks the operational tail.
2. `docs/plans/2026-07-09-001-feat-tv-experience-details-restyle-plan.md` — implementation-ready: migrates the Experience render path to `WATCH_THEME`, extends `VideoBackdrop`. Candidates 1–3 below are sequenced around it.
3. `docs/brainstorms/2026-06-30-tv-client-performance-sweep-requirements.md` — owns series payload trim, search gating, bible-verse N+1, home skeleton.

Also standing: the two coexisting design systems (Crimson Gallery vs `WATCH_THEME`) are a documented product decision (`apps/tv/CLAUDE.md` "Design Systems"). Theme unification is **not** a candidate.

---

## Candidate 1 — One focus visual, one module (STRONG; top recommendation)

> **Status 2026-07-12: COMPLETE — both tranches landed** (see Implementation status above). The `useFocusAnimation` adapter is deleted; every consumer rides `src/components/focus/` role presets. Error-state retry pills remain visually unverified (needs forced failures).

**Files:** `src/components/FocusableCard.tsx` · `src/components/watch/useFocusAnimation.ts` · ~10 hand-rolled/hybrid sites: `RetryButton.tsx:17`, `ExperienceRenderer.tsx:279` (ErrorState), `search/SearchResultsGrid.tsx:213` (retry), `app/index.tsx:369` (retry), `sections/RelatedQuestionsRenderer.tsx:157` (QuestionRow), `home/MissionSection.tsx:121` (QR tile), `home/HomeTopBar.tsx:191` (tabs), `home/HomeHeroCarousel.tsx:246` (CTA/chevron), `watch/DetailsActionRow.tsx:137` (pills), `watch/WatchOptionRow.tsx:53`.

**Problem.** One visual concept (scale + ring on D-pad focus) has ~12 implementations. Two engines on different physics: `FocusableCard` is the only `Animated.spring` (tension 150 / friction 10, ring alpha 0.90, scale 1.05, no lift); `useFocusAnimation` is `Animated.timing` 180ms bezier (ring alpha 0.88 via `useThumbFocusRing`, magnify 1.06, lift). Ten more sites hand-roll or half-use an engine. Measured drift: scale 1.015–1.1, lift 0–scale(8), focus-shadow radius 14–25, three different Android shadow policies (HomeCard drops shadows on Android, ResultCard keeps elevation 12, FocusableCard keeps elevation 8), and `dd-action-name` threaded five different ways. The Android focus-visual bridge (the committed `react-native-tvos` Pressable patch) is load-bearing and its quirks are re-handled per site.

**Deepening.** One deep focus-visual module with a role-preset interface (roles: card, pill, key, tile; a couple of overrides). Curve, ring, lift/shadow scale, Android compositing quirks (`needsOffscreenAlphaCompositing`, `renderToHardwareTextureAndroid`, elevation policy), and `dd-action-name` threading become implementation. Both engines and all one-offs collapse into it.

**Wins.** Locality: Android focus quirks fixed once. Leverage: one interface, ~30 call sites. The restyle plan's R5 (white ring everywhere) becomes structural. Deletes ten shallow one-offs.

**Why first.** Smallest interface for the widest duplication; candidate 2 consumes it; landing before the restyle turns per-file focus discipline into adoption. Focus is where this app's bug history concentrates (react-native-tvos #852, the Android Pressable focus bridge, the `focus.restore_failed` RUM signal).

**Grep:** `useFocusAnimation`, `useThumbFocusRing`, `Animated.spring`, `focusRing`, `onFocus.*setFocused`, `dd-action-name`.

## Candidate 2 — One card, one rail (STRONG)

**Files:** `home/HomeCard.tsx` · `search/ResultCard.tsx` · `series/EpisodeRail.tsx` · `watch/UpNextRail.tsx` · `home/HomeRail.tsx` · `src/components/ContentRail.tsx` (orphaned) · `sections/{VideoCarousel,MediaCollection,NavigationCarousel,BibleQuotes}Renderer.tsx`.

**Problem.** Twelve card implementations and eight horizontal rails re-implement one thumb card and one focus rail.

- `EpisodeRail.tsx:125` and `UpNextRail.tsx:77` both define a local `EpisodeCard`: identical dims (360 × 168.75), identical `useThumbFocusRing`/`THUMB_SHADOW`/style objects; divergence is one eyebrow line and an icon.
- `HomeCard` ≈ `ResultCard`: same 2.13:1 thumb + chip + title-on-focus, but ResultCard hand-rolls a static ring and inline shadow instead of the shared hook, on different theme constants.
- The load-bearing tvOS focus logic — windowing (`VISIBLE_COLUMNS`), the RailPad overhang catcher, `trapFocus*`, focus restore via `requestTVFocus` — exists in **one rail of eight** (`HomeRail.tsx:36–88, 213–217`). Only HomeRail and EpisodeRail declare `getItemLayout`.
- `ContentRail.tsx` (the generic rail) has **zero JSX consumers** — referenced only in comments (`SearchResultsGrid.tsx:179`, `UpNextRail.tsx:3`).

**Deepening.** One deep ThumbCard module (thumb + title + meta chip + focus visual + Android image-windowing; theme tokens in) and one deep FocusRail module (TVFocusGuideView + FlatList + getItemLayout + windowing + overhang catcher + focus restore + heading). Surfaces become adapters. Delete both duplicate EpisodeCards and the orphan.

**Sequencing.** The restyle plan re-styles every SDUI rail/card to match HomeRail/HomeCard. Land this first and that migration is adoption; land it second and every renderer gets edited twice.

**Grep:** `EpisodeCard`, `getItemLayout`, `TVFocusGuideView`, `VISIBLE_COLUMNS`, `trapFocusLeft`, `ContentRail`.

## Candidate 3 — Type the block seam (SDUI + search) (STRONG)

**Files:** `src/lib/normalizer.ts:49` · `sections/SectionDispatcher.tsx` · all `sections/*Renderer.tsx` · `src/lib/queries.ts` fragment aliases (`rqHeading:39`, `bqcHeading:52`, `videoTitle:100`, `mcTitle:124`, `vcTitle:147`) · `src/lib/queries.ts:399` (`SearchResult` raw type) → `app/search.tsx:17` and `search/*`.

**Problem.** Watch, series, and home shape data at a real model seam (`WatchVideoRecord`, `WatchSeriesRecord`, `WatchHomeModel`); the Experience pipeline and search bypass it. The SDUI normalizer emits `NormalizedBlock = { kind; __typename; [key: string]: unknown }`, so every renderer re-casts aliased fragment fields inline (`section.mcTitle as string` at `MediaCollectionRenderer.tsx:63–66`, `section.rqHeading as string` at `RelatedQuestionsRenderer.tsx:209`). The block contract lives half in `queries.ts` aliases, half in renderer casts; an alias rename fails silently to `undefined`, never at compile time. Search threads the raw gql.tada result shape unnormalized through `SearchResultsGrid`/`ResultCard`. Note: `normalizer.ts:1` claims sync with `apps/mobile/src/lib/normalizer.ts`, which **does not exist** — the copy contract is dead, so TV is free to deepen here.

**Deepening.** The normalizer emits a discriminated union of typed block models; renderers take typed props; the dispatcher switch becomes exhaustiveness-checked (`never` check). Give search a normalized result-card model at the same seam.

**Wins.** Alias renames become compile errors; the block contract gets one module; the restyle's 12-renderer migration works against typed props.

**Grep:** `NormalizedBlock`, `as MediaItem`, `mcTitle`, `vcTitle`, `rqHeading`, `TYPENAME_TO_KIND`, `SearchResult`.

## Candidate 4 — One owner for the Watch Session's Dub media (WORTH EXPLORING)

**Files:** `src/contexts/WatchSessionProvider.tsx` · `watch/useSessionPlayback.ts` · `watch/{SubtitlePanel,InPlayerMenu,SubtitleOverlay}.tsx` · `watch/{panelState,playerSwitch,watchSessionState}.ts` · `src/components/VideoPlayer.tsx`.

**Problem.** Switching a Dub mid-playback crosses nine modules (MenuPill → useSessionPlayback.openMenu → InPlayerMenu → panelState → WatchSessionProvider → watchSessionState → playerSwitch → replaceAsync/latches → VideoPlayer statusChange/QoE-suppress). "Load the active Dub's media" (`ensureActiveVariantMedia`, `WatchSessionProvider.tsx:155–208`) is triggered from four independent sites (`SubtitlePanel.tsx:31`, `InPlayerMenu.tsx:45`, `useSessionPlayback.ts:260`, plus a provider effect). The menu gate is a hand-latched ref (`menuLatchedRef`, `useSessionPlayback.ts:128–136`) because the raw gate flips false mid-switch. VideoPlayer looks deep (4 props over 1946 lines) but its true interface is much larger: it throws without `WatchSessionProvider` (`WatchSessionProvider.tsx:310`) via a transitive hook, callers must never change `streamingUrl` to switch Dubs (frozen source, `VideoPlayer.tsx:905–915`), and the two-player decoder invariant lives in a sibling (`VideoBackdrop.tsx:197` gating on `overlayVisible`).

**Deepening.** The Watch Session module owns fetch triggers, latching, and source replacement behind a small interface (`activeDub`, `subtitleTrack`, `vttSrc`, `switchDub()`, `setSubtitle()`). Panels and player consume outputs, never drive fetches. Put a player adapter behind a seam: expo-video in prod, a fake in tests — two adapters make the seam real and the untested switch orchestration gains a test surface.

**Grep:** `ensureActiveVariantMedia`, `menuLatchedRef`, `shouldReplaceSource`, `sourceSwappingRef`, `useWatchSession`.

## Candidate 5 — Deepen the machines, not just the deciders (WORTH EXPLORING)

**Files:** `src/hooks/useWatchHome.ts` (330 lines post-#1526) · `src/lib/search.ts:87` (`useSemanticSearch`, 293 lines) · `src/hooks/useBibleVerses.ts` · `VideoPlayer.tsx:1307–1379` (Chrome auto-hide) · `WatchSessionProvider.tsx:155–265` (effects).

**Problem.** The house pattern extracts pure deciders into React-free `.ts` files and tests them thoroughly, then leaves the orchestration above untested by construction (the constraint is stated at `WatchSessionProvider.test.tsx:1–14`: jest can't mount the JSX module graph). All three review sweeps found the same shape: the Home Snapshot keep-or-swap race, requestId stale guards, the search debounce/double-submit refs, and the Chrome auto-hide timer gates are exactly where the documented bug classes live, and none has a test. **#1526 extended the pattern once more**: the fallback ladder became a pure, tested `reconcileWatchHome` (`watchHome/experienceAdapter.ts`; `useWatchHome.test.ts` tests only that ladder), while the hook's untested orchestration grew — `requestIdRef` re-checks after every await (`useWatchHome.ts:137,208,212,260,265`), snapshot keep-or-swap, chunked top-up sequencing.

**Deepening.** Move the seam up one level: each machine becomes a React-free module with injected dependencies (fetch, storage, clock, player); the hook shrinks to an adapter. Two adapters (React runtime, test harness) justify the seam. This is the codebase's own extraction move, taken one level higher. Post-#1526 the remaining `useWatchHome` step is smaller than it was: the deciders already exist; inject the effects and pull the awaits into the machine.

**Grep:** `requestIdRef`, `networkLandedRef`, `snapshotVideosJsonRef`, `skipNextDebounceRef`, `scheduleHideRef`, `reconcileWatchHome`.

## Candidate 6 — One screen-state module (WORTH EXPLORING)

**Files:** `app/index.tsx:348–401` · `app/series/[slug].tsx:264–286` · `app/watch/[slug].tsx:141` · `ExperienceRenderer.tsx:159–187` · `search/searchDisplay.ts` · `lib/watchHome/homeScreenState.ts` · `series/seriesScreenState.ts` · `RetryButton.tsx`.

**Problem.** Five surfaces run five independent loading/error/empty/content machines with different error philosophies (home converts errors to a retryable message and keeps stale content; watch shows error only when nothing is renderable; series/experience surface `error.message` raw). Two of the five extracted their branch order into a tested resolver; three re-derive it inline. Only the retry control is shared. Each machine's interface is nearly as complex as its implementation: shallow.

**Deepening.** One deep screen-state module: precedence resolver + loading/error/empty views behind one interface; screens supply content and a retry callback. The Experience path's states get `WATCH_THEME` through the shared module (restyle U1 touches them anyway).

**Grep:** `resolveHomeScreenState`, `resolveScreenState`, `showErrorState`, `RetryButton`, `resolveSearchMeta`.

## Candidate 7 — Give the card image one module (WORTH EXPLORING)

**Files:** `src/lib/videoQueries.ts:19,46,64,135,211` · `src/lib/watchHome/homeQueries.ts:21,44` · `src/lib/normalizeVideo.ts:131` (`pickPosterUrl`) · `src/lib/watchHome/model.ts:127` (`pickAdminImage`) · `src/lib/types.ts:24` (`pickThumbnailUrl`).

**Problem.** "Which fields make a card image, and which wins" is smeared across ~9 hand-duplicated GraphQL image selections, three pickers with three different precedence orders (`pickPosterUrl`: high → url → thumb; `pickAdminImage`: high → low → still → url → thumb; `pickThumbnailUrl`: high → still → url), and two re-declared input types. Adding one image field is ~14 edits across 5 files. (#1526 added no new selection or picker — the new `GET_WATCH_SETTING` consumes the shared `AdminWatchExperience` fragment.)

**Deepening.** One shared `ImageFields` fragment + one picker module where the precedence orders either converge or become named intents (poster / thumb / backdrop). First grilling question: are the three orders deliberate per surface, or drift?

**Grep:** `mobileCinematicHigh`, `pickPosterUrl`, `pickAdminImage`, `pickThumbnailUrl`, `videoStill`.

## Candidate 8 — A real seam for the mobile copy-sync (SPECULATIVE; cross-app)

**Files:** ~18 TV files with SYNC headers ↔ `apps/mobile` counterparts: `normalizeVideo.ts`, `watchHome/model.ts`, `isSeriesRecord.ts`, `pickLocalizedName.ts`, `resolveDefaultLanguage.ts`, `resolveImageUrl.ts`, `muxUrl.ts`, `dubMediaFetch.ts`, `authHeaders.ts`, `hooks/useWatchHome.ts`, `hooks/useBibleVerses.ts`, …

**Problem.** Mobile and TV are two adapters of the same logic (a real seam, by the two-adapter rule) maintained by hand-copying with a comment. Zero tests assert parity, and it has already drifted where it matters: the Series-Shaped classification differs by case-sensitivity (TV `Set(["SERIES","COLLECTION"])` strict-uppercase, mobile lowercase + `.toLowerCase()`), `normalizeVideo` has structurally forked (types, KTD5 self-filter, `imageAlt`), and `normalizer.ts:1` syncs against a mobile file that no longer exists. `CONCEPTS.md` requires every entry point to apply the same Series-Shaped rule — the two apps currently don't share one.

**Deepening.** Extract the stable pure core (Series-Shaped test, localized-name pick, language defaulting, Mux URL) into a shared package; each app keeps its lean query documents and platform wiring. **Caution:** the query-document divergence is deliberate (the 9.5MB Dub payload incident) — share pure primitives only, never operations. Bigger than a TV-only change; Urim owns web/mobile/TV so it is in-lane, but scope it consciously.

**Grep:** `SYNC: ported from apps/mobile`, `isSeriesLabel`, `pickLocalizedName`.

---

## Deletion-test failures (quick wins, all verified 2026-07-12)

Deleting these makes complexity vanish rather than reappear:

- `src/components/ContentRail.tsx` — orphaned; referenced only in comments.
- `src/contexts/ExperienceProvider.tsx:55–106` — `getSectionByKey` / `useSectionByKey` / the `sectionMap` memo: zero consumers.
- `src/lib/config.ts:18` `getLocale` — zero non-test callers (screens hardcode `locale: "en"`).
- `src/lib/watchHome/model.ts:173` `resolveFeaturedTitle` — test-only export, unwired.
- `src/lib/types.ts` `VideoRef` — zero usages (keep `pickThumbnailUrl` in the same file; 3 callers).
- `src/components/series/EpisodeRail.tsx:58` `onEpisodePress` override — never passed (hypothetical seam).

Kept deliberately: `resolveDefaultLanguage`'s `preferredLanguageSlug` branch (Watch Preference is a planned concept) · `TextRenderer`'s inline color copy (restyle plan U1 already deletes it).

## Reviewed but not proposed (owned by standing decisions)

Theme unification (restyle plan; two design systems is a documented decision) · series payload & lazy language load, search gating, bible-verse N+1 (performance sweep) · home rows onto the Homepage Experience (shipped as #1526; feat-246 tracks the tail).

## Ranking and dependencies

1. **Candidate 1** first: smallest interface, widest duplication, consumed by candidate 2, makes the restyle's focus rule structural.
2. **Candidate 2** second, before the restyle plan's U2 if possible.
3. **Candidate 3** pairs well with the restyle (typed props for the renderers it touches).
4. **Candidate 5**'s `useWatchHome` slice is best done while #1526 is fresh.
5. Candidates 4, 6, 7 are independent. Candidate 8 needs its own cross-app scoping conversation.

Dead-code deletions can ship any time as a `chore:` PR.

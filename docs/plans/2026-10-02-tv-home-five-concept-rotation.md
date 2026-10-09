# TV system Home: five-concept rotation

Status: implemented on `codex/tv-system-home-five-concepts`; system Home QA and rollout remain pending. See `docs/tv-system-home-validation-2026-10-02.md`.
Scope: `apps/tv` Apple TV Top Shelf first; Android TV/Google TV counterpart researched separately. Preserve existing players, in-app Home and recommendations work.

## Product decision

Rotate among five eligible content concepts without changing content under the user's focus. Use the shared anonymous recommendation API as the primary discovery source, preserving its ranked public media metadata; Continue Watching uses real local unfinished history. Curated Home collections supply topic membership and SDK media-kind validation. Generated images are visual references, not exact OS layout specifications. Use existing published content and official artwork rather than generated substitutes or fabricated durations.

| Concept                    | Apple native presentation                                          | Eligibility and destination                                                                                                       |
| -------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| 1. Cinematic Spotlight     | Details carousel with title, summary, artwork and optional preview | Published playable film; Play launches playback, More Info opens details                                                          |
| 2. Continue Watching       | Sectioned items with native playback progress                      | Reuse existing unfinished-watch rules; resume from current local progress, not a timestamp embedded in a stale URL                |
| 3. Discover the Collection | Sectioned shelf of individually selectable films                   | At least two validated film destinations, deduplicated; selecting opens details                                                   |
| 4. A Moment of Hope        | Details carousel promoting an existing short film                  | Verified duration and playable audio; use actual metadata, not the mockup's fictional three-minute title                          |
| 5. Choose Your Journey     | Sectioned topic cards                                              | Published Home topic collections containing recommended videos; display opens `/top-shelf-topic/[id]`, no Play action for a topic |

Use public TVServices APIs only. Apple controls button labels, placement, focus visuals and preview behavior. Do not promise arbitrary overlays, custom buttons, multiple independent layouts at once or exact mockup geometry. A refresh notification is asynchronous, not a guarantee of immediate display.

## Rotation policy

- Equal-probability shuffled bag of eligible concepts, persisted locally. No adjacent repeat when at least two concepts qualify; use all eligible concepts before refilling the bag.
- Proposed cadence: at most one rotation per local calendar day, computed on the next normal app foreground/content preparation opportunity. The day boundary does not run a timer or force a Home-screen replacement.
- Do not randomize inside `loadTopShelfContent`: repeated OS calls return the same persisted snapshot.
- Prepare the next snapshot while the app is foregrounded; notify tvOS only when the snapshot changes. No background timer cycling while the user browses system Home. OS display timing remains outside app control.
- Re-evaluate eligibility after a meaningful watch-history, audio-language or content update. Remove invalid/completed/deleted items even if the daily choice would otherwise remain stable.
- No watch history: omit concept 2. No verified short/topic content: omit concepts 4/5. One eligible concept: keep it. No valid content: return bundled verified editorial fallback or the existing static Top Shelf image.
- Preserve last good, unexpired snapshot on transient fetch failures; never substitute a wrong audio language or resurrect known-unpublished media. Revalidate at destination before playback.

## Implementation boundaries

1. Start a dedicated branch from current main when implementation begins. Do not merge an entire archive branch or mix this into recommendations/signup PRs.
2. Selectively recover the extension scaffold from `codex/archive/2026-10-02/apple-native-top-shelf-interactive`:
   - `apps/tv/plugins/withTopShelf.js`
   - `apps/tv/top-shelf/ContentProvider.swift`, `Info.plist`, `catalog.json`
   - `apps/tv/scripts/topShelf.test.js` and its PBX fixture
   - approved artwork/preview assets only, with source and rights verified.
3. Existing provider is a bundled four-film `.details` carousel, with `org.jesusfilm.forgetv://watch/<slug>?autoplay=1` play routes. It does not yet implement rotation or shared resume state. Verify the actual app scheme and current route contract before reuse.
4. Add a small TV-owned selector and validated snapshot model under `apps/tv/src/lib/topShelf/`. Fields: schemaVersion, concept, generatedAt, expiresAt, language, stable item IDs, public content identifiers, title/artwork/preview metadata and action type. Store selection state separately from content.
5. App owns content fetching and current watch history (`apps/tv/src/lib/watchEvents/continueWatching.ts`); native bridge writes a bounded atomic snapshot to an App Group shared with the extension. Register matching app/extension entitlements through Expo config plugins so clean prebuild and EAS retain them. Provisioning is a release gate, not an assumed capability.
6. Extension reads that snapshot and maps it to carousel or sectioned content. No React Native runtime, expensive image generation or large API pipeline in the extension. Bounded decode, capped item count and cached artwork; no launch-blocking fetch on the app's critical Home path.
7. Whitelist deep-link actions and validate encoded identifiers. Handle cold/warm launch exactly once; preserve native A/B and React player choice. Resolve resume position and current audio in-app. Invalid links return to a safe app screen with a useful message.
8. Keep credentials, viewer/session tokens and recommendation capabilities out of URLs, extension snapshots and logs. A TV Home shelf is visible to anyone using that TV; document local-history behavior and clear corresponding resume items when history is removed. Do not imply separate tvOS users have separate app histories unless implemented.

## Delivery phases

1. Restore extension scaffold and prove spotlight plus display/play deep links on an isolated Apple TV 4K simulator.
2. Add snapshot sharing and native renderer mappings; validate all five modes with fixed development-only mode selection.
3. Add eligibility, shuffled rotation, stability and fallbacks; fixed mode override must not ship in production UI.
4. Run review, performance comparison and signed release-build validation. Ship via normal PR-to-main and TestFlight only after approval; no direct production deploy.

## Acceptance checks

- Unit tests: five modes, shuffled-bag coverage, no adjacent repeat, one/zero eligible modes, same-day stability, restart persistence, clock/date changes and eligibility changes.
- Native extension: correct title/artwork/progress, missing preview fallback, repeated content-provider calls, offline snapshot and malformed/version-mismatched data.
- Navigation: cold and warm Play/More Info, topic destination, existing resume rules, completed/removed item, every configured player remains unchanged.
- App Group entitlements and embedded extension survive clean prebuild; both Debug and signed Release compile. Keep simulator ad-hoc signing enabled for Keychain.
- Performance: compare main baseline with feature on/off; no extra blocking startup requests, no synchronous media processing, bounded extension memory and stable focus during updates.
- Verify system Home display with Watch in top row on simulator. Physical Apple TV testing is excluded unless the user explicitly changes that instruction; any unverified OS/device behavior is reported, not assumed.
- Android SDK implementation and QA remain separate from this Apple-only PR.

## October 7 startup compatibility scope

The user requested physical Apple TV installation/run. Xcode 27 built and signed the current app, but tvOS 27 rejected its legacy application lifecycle before React Native started. Add a TV-owned Expo config plugin with one window scene, start the existing React factory from that scene, forward cold/warm links and Expo lifecycle callbacks, and preserve UIKit's aggregate AppState notifications. Keep all players, Top Shelf rendering, Android and other apps unchanged. Verify plugin idempotence/template guards, prebuild persistence, signed Release installation, visible Home, cold/warm movie links and Native A playback on Office Apple TV. Do not upgrade Expo or change store/release state.

## Beta Top Shelf selector

The user approved a beta-only Settings selector with Automatic and all five styles. Visual thesis: reuse the existing WATCH Settings radio rows and white remote focus. Content: a Top Shelf — Beta section with six choices and a short note about returning to Apple TV Home and unavailable-content fallback. Interaction: keep the existing focus animation, persist the choice, and republish on explicit beta selection without restarting the player. Gate both UI and override by `EXPO_PUBLIC_TV_TOP_SHELF_PREVIEW_ENABLED`; unset/production builds retain the existing rotation. Never fabricate resume history or topic/video metadata. Preserve automatic rotation state when previewing, and ignore stored preview choices when the build flag is off.

## Android TV / Google TV companion

Agent research recommends Engage SDK TV 1.1.0, rechecking the supported version
at implementation. This is native Kotlin behind an Expo module, not an Expo
OTA-only change. Preserve native default and React fallback players.

- Spotlight, collections, short films and topical discovery become supported
  movie/show recommendation entities grouped into clusters. Topics are cluster
  headings containing real playable films, not fake movie entities.
- Continue Watching uses the separate Engage continuation integration. Keep
  genuinely unfinished items available independently of discovery rotation;
  do not randomly remove resume history. This differs intentionally from the
  Apple concept-level selection.
- Persist a shuffled eligible bag for the four discovery themes, avoid adjacent
  repeats, and publish at most once daily through the documented foreground
  service mechanism. Google controls placement and actual refresh timing.
- Recommendation publishing requires Google eligibility/onboarding, relevant
  service availability, adult-account eligibility and explicit cross-device
  sharing consent with `syncAcrossDevices=true`. This requirement is separate
  from Forge's internal recommendation/analytics policy. Do not silently enable
  Profile or reuse a random demo account identifier as production identity.
- Same-device continuation can use `syncAcrossDevices=false`; cross-device
  continuation requires its own valid account/consent arrangement. Withdrawals,
  completed items and removed history must update/remove published content.
- Confirm package onboarding, manifest settings, `WRITE_EPG_DATA` and availability
  per cluster. A verifier pass is not proof of Google TV Home placement.

Selectively recover from `codex/archive/2026-10-02/android-native-google-home`:

- `apps/tv/modules/google-tv-home/` (TypeScript bridge, Kotlin module, Gradle and main/release/verification manifests)
- `apps/tv/src/lib/googleTvHomeDemo.ts` and tests
- `apps/tv/src/components/settings/GoogleTvHomeScreen.tsx`
- `apps/tv/src/components/GoogleTvHomeFeatures.guard.test.js`
- `docs/solutions/integration-issues/google-tv-engage-production-verification-gates.md`

The archived demo validated three real films with the official verifier, but
reported production recommendations unavailable on Chromecast. This is historical
evidence: check current availability before diagnosing today's device. Keep
verification and production builds separate; do not bypass availability gates.

Android-specific release gates: pure selection/duplicate/daily-limit tests;
native build; verifier; current production-service availability; real launcher
visibility; cold/warm playback deep links and exact resume position. These are
separate proofs. Do not add publication or network latency to initial Home render.
Internal testing only after review and approval. Since the Android TV emulator
was deleted for storage, agree on a target and available disk before recreating
one or running physical Chromecast tests.

If Engage eligibility blocks launch, defer that surface. AndroidX TV Provider
preview channels may be a separate optional integration for compatible Android
TV launchers, not an allowlist bypass or a guaranteed Google TV replacement.

Android sources:

- [Engage TV setup and eligibility](https://developer.android.com/guide/playcore/engage/tv/getting-started)
- [Engage recommendations](https://developer.android.com/guide/playcore/engage/tv/recommendations)
- [Continue Watching client](https://developer.android.com/guide/playcore/engage/tv/continue-watching/client)
- [Engage FAQ](https://developer.android.com/guide/playcore/engage/faq)
- [Android TV preview channels](https://developer.android.com/training/tv/discovery/recommendations-channel)

## Apple official references

- [TVTopShelfContentProvider](https://developer.apple.com/documentation/tvservices/tvtopshelfcontentprovider)
- [TVTopShelfCarouselItem](https://developer.apple.com/documentation/tvservices/tvtopshelfcarouselitem)
- [TVTopShelfSectionedItem and progress](https://developer.apple.com/documentation/tvservices/tvtopshelfsectioneditem)
- [System-selected action buttons](https://developer.apple.com/documentation/tvservices/tvtopshelfaction)
- [Asynchronous refresh notification](<https://developer.apple.com/documentation/tvservices/tvtopshelfcontentprovider/topshelfcontentdidchange()>)
- [Extension memory constraints](https://developer.apple.com/documentation/tvservices)

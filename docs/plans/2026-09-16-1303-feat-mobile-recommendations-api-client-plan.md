---
title: "Mobile Recommendations API Client - Plan"
type: feat
date: "2026-09-16"
topic: mobile-recommendations-api-client
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: handoff
execution: code
---

# Mobile Recommendations API Client - Plan

## Goal Capsule

- Objective: the mobile app can bootstrap an anonymous recommendation viewer, request a source-free slate, record evidence and selection, and attribute playback to the same installation profile, through the shared Admin API.
- Means: an operation allowlist on the existing fleet bearer, a viewer identity store in secure storage, pure client modules for delivery, evidence, selection and playback facts, and one wiring point inside the app's single player adapter.
- Product authority: the recommendations API handoff of 14 September 2026 and `docs/operations/user-recommendations.md`.
- Execution profile: JavaScript only. No native module, no fingerprint change, no schema change. The work ships in an OTA update.
- Boundary: no Home shelf in this plan. The UI row is `feat-517`; this plan gives it the data layer and the hook it needs.
- Stop conditions: stop if Admin rejects a fleet bearer on `createRecommendationViewer` in a real environment, because the identity design rests on `RecommendationViewerService.bootstrap` accepting a fleet consumer bearer.

## Product Contract

### Summary

The app owns one anonymous recommendation viewer per installation. Every playback the root host owns claims a playback episode and sends strict playback facts, so the installation's profile learns from what the viewer watches. A hook delivers a ranked slate for a UI locale and an audio language, with evidence and selection helpers bound to that slate.

### Problem Frame

The Admin API for source-free recommendations is merged and live for Web. Mobile has none of the client side. Mobile's Apollo auth link attaches the fleet bearer to `WatchSearch` only, so importing the shared operations alone fails with `UNAUTHENTICATED`. Admin accepts a fleet bearer on recommendation operations only when a viewer handle proves the installation, so the client must bootstrap and carry that handle on every call.

### Key Decisions

- KD1. The fleet bearer and `x-viewer-id` ride exactly the eight recommendation operations mobile sends, through the existing `authHeadersForOperation` gate. Web-only operations that require a session digest are never allowlisted. Governs R1, R2.
- KD2. The viewer identity is one JSON record in SecureStore, this-device-only, loaded lazily with a single in-flight bootstrap. An expired handle re-bootstraps. A rejected handle is re-verified with `status` and replaced only when a bootstrap under the same bearer succeeds, because Admin's `UNAUTHENTICATED` cannot tell a dead handle from a broken bearer (the consumption guide: "validate configuration before discarding a stored viewer"). Governs R3, R4, R5.
- KD3. Session rotation after 24 hours of inactivity needs a cryptographically random source. The runtime has none today (no `expo-crypto`, no `crypto.getRandomValues` on Hermes), so the server-minted session token persists until a source exists. A playback hold blocks rotation mid-playback. Governs R6.
- KD4. An unprovisioned fleet bearer makes the whole feature report `unprovisioned` without a network request. Governs R7.
- KD5. Delivery validates a served slate strictly: `served`, a request id, the requested count, distinct target media, and positions in index order. Transient reasons retry once after five seconds, up to three attempts. `environment_disabled` is `disabled`. Nothing is substituted. Governs R8, R9, R10.
- KD6. Evidence and selection mirror Web's literals: `recommendation-evidence-v1`, `watch-for-you-v1` as both surface and visibility policy. Impression eligibility (50% visible for one continuous second) belongs to the UI. Selection stores a pending claim keyed by target media id for the playback recorder. Governs R11, R12, R13.
- KD7. Playback attribution runs inside `useManagedVideoPlayer` for the session-owning host when the request carries an Admin video id. A pending selection claim is used first; otherwise the recorder issues a playback context (`search`, `share` or `direct`) and claims it. Facts follow Admin's strict schemas and Web's caps. Governs R14 to R19.
- KD8. `EXPO_PUBLIC_RECOMMENDATIONS_ENABLED` is an optional kill switch; unset means enabled, `false` or `0` disables. Flipping it needs an update publish because Expo inlines the value. Governs R20.
- KD9. Telemetry attributes are `rec_`-prefixed. No token, capability, nonce or episode id is ever logged. Governs R21.

### Requirements

- R1. `authHeadersForOperation` attaches the bearer and `x-viewer-id` for the eight recommendation operations and for `WatchSearch`, and for nothing else.
- R2. A guard test pins the allowlist to the operation names of the shared documents mobile imports, and pins the exclusion of the web-only digest operations.
- R3. `getRecommendationViewer()` returns the stored identity, or bootstraps once when none exists or the handle expired. Concurrent callers share one bootstrap.
- R4. The identity record persists through the same SecureStore adapter shape as the auth session, with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
- R5. An `UNAUTHENTICATED` answer on any operation marks the record suspect. The next read re-verifies it with `status`; a rejected verification followed by a successful bootstrap replaces the handle, a rejected bootstrap keeps it and reports unavailable with a cooldown. A profile transition or a replaced handle notifies subscribers so a displayed slate refreshes.
- R6. When a secure random source exists and the session is older than 24 hours of inactivity and no playback hold is set, the client mints a new 32-byte base64url session token, persists it, and calls `status` before any other operation.
- R7. With no fleet bearer configured, every client entry point returns `unprovisioned` and sends nothing.
- R8. `fetchUserRecommendations` sends `viewerToken`, `sessionToken`, `locale`, `audioLanguageSlug` and `count`, with `fetchPolicy: "no-cache"` and a 3,000 ms deadline below the client's 15 s ceiling.
- R9. A served slate that fails validation reports `invalid_delivery`; a `coverage_unavailable` slate reports `unavailable` and is not retried.
- R10. The hook exposes `status`, `items`, `refresh`, `recordRender`, `recordImpression` and `select`, keeps capabilities in memory only, and refreshes on locale or audio language change.
- R11. `recordRender` and `recordImpression` send one evidence event each, deduplicated per request id, item id and kind, and never throw.
- R12. `select` mints a claim nonce of at least 16 characters, sends the selection with an 800 ms deadline, stores the pending claim, and resolves with the video slug even when the send fails.
- R13. The pending claim store holds one claim, expires it after ten minutes, and hands it out once.
- R14. The recorder emits `playback_attempt` with `initiation: "manual"` at session start, `playback_start` on the first playing tick, and `playback_progress` every 10 s while playing.
- R15. Active foreground playing time is accumulated and emitted as `playback_active_visible_playing` chunks of at most 60,000 ms with `coverage: "complete"`, on pause, background, terminal and every 60 s.
- R16. Pause, resume, background and foreground emit `playback_navigation`; a stall and its recovery emit `playback_qoe`; a position jump larger than two seconds between ticks emits `playback_seek`.
- R17. Terminal facts: `playback_end` with `reason: "ended"` and `completed: true` on play-to-end; `reason: "route_exit"` on dismiss, replace or unmount; `playback_error` with `code: "media_error"` on a player error. After a terminal fact the recorder accepts nothing.
- R18. Facts batch at most 16 per mutation and at most 8 KB of serialized variables, at most 128 facts per episode with Web's per-kind caps. Transport failures retry up to three times with backoff; `UNAUTHENTICATED`, `BAD_USER_INPUT` and `CONFLICT` drop the batch and end the episode.
- R19. Facts recorded before the claim settles are held (at most 16) and sent after it. A definitive claim failure drops them and makes the recorder inert for that playback.
- R20. With the kill switch off, the adapter creates no recorder and the hook reports `disabled` without a request.
- R21. The client logs `recommendation.delivery`, `recommendation.identity` and `recommendation.playback_degraded` through `datadogLog` with `rec_`-prefixed attributes only.

## Existing implementation and research

- Transport: `apps/mobile/src/lib/authHeaders.ts` scopes the fleet bearer to `WatchSearch`; `apps/mobile/src/lib/apolloClient.ts` composes the link chain and reports GraphQL errors to Datadog.
- Storage pattern: `apps/mobile/src/lib/authSession.ts` (`createSecureStorageAdapter`, lazy singleton, injected deps).
- Player seam: `apps/mobile/src/hooks/useManagedVideoPlayer.ts` owns the 1 s poll, the AppState pair, `playToEnd`, `statusChange` and `endSession(reason)`; `PlaybackHost` is the only `ownsSession: true` caller and passes `progress: { videoId }`.
- Admin contract: `apps/admin/src/services/recommendations/contracts.ts` (strict playback schemas), `evidence.service.ts` (render and impression), `viewer-identity.service.ts` (token shape `^[A-Za-z0-9_-]{43}$`, 180-day handle, bootstrap accepts any consumer bearer), `caller.ts` (fleet callers need a verified viewer), `graphql/recommendation-errors.ts` (error codes).
- Web reference: `apps/web/src/components/recommendations/WatchForYouRecommendations.tsx` and `RecommendationPlaybackRecorder.tsx`.
- Rate limit: 30 mutations per minute per fleet bucket, keyed `consumer:<key>:v:<x-viewer-id>`.

## Implementation units

### U1. Operation allowlist

Files: `apps/mobile/src/lib/authHeaders.ts`, `apps/mobile/src/lib/recommendations/operations.ts`, `apps/mobile/src/lib/__tests__/authHeaders.test.ts`, `apps/mobile/src/lib/recommendations/__tests__/operations.contract.test.ts`.

Export `RECOMMENDATION_OPERATION_NAMES` and `isRecommendationOperation`. Widen `authHeadersForOperation` to a bearer-carrying set. The contract test validates each shared document against `apps/admin/schema.graphql` with graphql-js and pins that mobile never sets `sessionDigest`.

### U2. Viewer identity

Files: `apps/mobile/src/lib/recommendations/random.ts`, `viewerIdentity.ts`, `viewerIdentityClient.ts`, tests.

Factory with injected deps (`storage`, `bootstrap`, `updateViewer`, `now`, `randomToken`). Record: `{ version: 1, viewerToken, viewerExpiresAt, sessionToken, lastActiveAt, personalization }`. Playback hold counter. Real wiring through Apollo `mutate` with `fetchPolicy: "no-cache"`.

### U3. Delivery and hook

Files: `apps/mobile/src/lib/recommendations/delivery.ts`, `context.ts`, `apps/mobile/src/hooks/useUserRecommendations.ts`, tests.

`fetchUserRecommendations` returns a discriminated result. `resolveRecommendationContext` maps watch preferences to `{ locale: "en", audioLanguageSlug: prefs.audioLanguageSlug ?? "english" }`. The hook owns retry timing and the evidence ledger.

### U4. Evidence, selection and discovery

Files: `apps/mobile/src/lib/recommendations/evidence.ts`, `selection.ts`, `playbackDiscovery.ts`, tests.

Pure variable builders plus fire-and-forget senders. Module-scope stores for the pending claim and the discovery source, both with tests.

### U5. Playback facts recorder

Files: `apps/mobile/src/lib/recommendations/playbackFacts.ts`, `playbackRecorder.ts`, `playbackRecorderClient.ts`, tests.

`createRecommendationPlaybackRecorder(mediaId, deps)` with inputs `attempt`, `tick`, `playingChange`, `visibility`, `stall`, `stallRecovered`, `error`, `end`. Deps: `claim`, `sendFacts`, `now`, `eventId`, `report`. Batching, caps and retry live here.

### U6. Adapter wiring

Files: `apps/mobile/src/hooks/useManagedVideoPlayer.ts`, `apps/mobile/src/hooks/__tests__/useManagedVideoPlayer.recommendations.test.tsx`.

Create the recorder next to the progress recorder when `ownsSession` and `options.progress?.videoId` are set and the feature is enabled. Feed it from the existing poll, `playingChange`, AppState, `statusChange`, `playToEnd` and `endSession`. A cast session suppresses ticks the same way it suppresses progress.

### U7. Flag, docs and roadmap

Files: `apps/mobile/src/env.ts`, `apps/mobile/src/lib/recommendations/enabled.ts`, `apps/mobile/CLAUDE.md`, `docs/roadmap/content-discovery/feat-516-mobile-recommendations-api-client.md`, `docs/roadmap/content-discovery/feat-517-mobile-recommended-for-you-shelf.md`, `docs/roadmap/content-discovery/feat-488-source-free-user-recommendations.md` (`blocks`), `docs/roadmap/README.md`.

## Verification

- `pnpm --filter @forge/mobile test`, `typecheck`, `lint`.
- `npx prettier --check` on every touched markdown file.
- The contract test validates the shared documents against the committed Admin SDL.
- No live endpoint: the handoff establishes no enabled development endpoint, and production must not receive test identities. A real-environment smoke of bootstrap, status and one playback episode is the first step of `feat-517`.

## Review amendments — 2026-09-16

The code review refined three requirements; the implementation and its tests follow these readings.

- R5: a suspect handle whose `status` probe fails transiently keeps serving and is not re-verified again for `VERIFY_RETRY_BACKOFF_MS` (60 s).
- R18: a rate-limited answer (`RATE_LIMITED`, from `extensions.http.statusCode: 429` or an edge HTTP 429) is transient and does not spend a delivery attempt. The drain pauses for the limiter's window, at most three times per episode; after that the batch drops and the episode stays open.
- R19: a claim that settles after `dispose()` still delivers the held facts once. After `dispose()` the recorder retries nothing, issues no context, and takes neither the selection nonce nor the discovery mark. A rate-limited claim waits the window once before it counts as failed.

## Review amendments, round 2 — 2026-09-17

- R11: a rate-limited evidence send retries once after the limiter's window (`Retry-After`, bounded to 60 s), never inside it.
- R19: the context issuance is part of the claim (KD7). It shares the claim's three attempts and its one window deferral, re-checks `dispose()` after every wait, and takes the discovery mark once. An issuance already in flight at `dispose()` settles like a claim in flight: it claims once and delivers the held facts, then stops. A facts drain already in flight at `dispose()` finishes its own retry ladder.
- R10: with `enabled` false the hook returns `reason: null` beside `status: "idle"`.

## Deferred

- Home shelf UI, block placement from the Experience, localized title, impression policy on FlashList (`feat-517`).
- ~~Session rotation on device (needs `expo-crypto`, a native build).~~ Done 2026-09-17: `expo-crypto` added as the device's random source; a native build must ship before the next update.
- `recordRecommendationContentAction` (share and download actions, `feat-372`).
- Account linking and cross-device history (out of scope by contract).

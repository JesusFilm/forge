---
id: "feat-516"
title: "Mobile recommendations API client and playback attribution"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-09-16"
duration: 2
depends_on:
  - "feat-488"
blocks:
  - "feat-517"
tags:
  - "mobile"
  - "recommendations"
  - "graphql"
  - "personalization"
---

## Problem

The source-free recommendations API (`feat-488`) is live for Web. Mobile has
no client for it: the Apollo auth link attaches the fleet bearer to
`WatchSearch` only, so importing the shared operations fails with
`UNAUTHENTICATED`, and nothing on mobile bootstraps a viewer, requests a slate,
records evidence, or attributes playback to an installation profile. Without
playback attribution the installation's profile never learns, so a future
shelf would serve cold-start slates forever.

## Entry Points — Read These First

1. `docs/plans/2026-09-16-1303-feat-mobile-recommendations-api-client-plan.md` — the design.
2. `apps/mobile/src/lib/recommendations/operations.ts` — the eight documents mobile sends and the contract literals.
3. `apps/mobile/src/lib/recommendations/viewerIdentity.ts` — the SecureStore-backed viewer store.
4. `apps/mobile/src/lib/recommendations/playbackRecorder.ts` — the episode recorder and its caps.
5. `apps/mobile/src/hooks/useManagedVideoPlayer.ts` — where the recorder is created and fed.
6. `apps/mobile/src/hooks/useUserRecommendations.ts` — the slate hook a UI consumes.
7. `apps/mobile/CLAUDE.md` "Recommendations API client (feat-516)".

## Grep These

- `carriesFleetBearer|RECOMMENDATION_OPERATION_NAMES`
- `createViewerIdentityStore|forge-watch.recommendation-viewer`
- `createRecommendationPlaybackRecorder|createPlaybackRecorderForMedia`
- `markPlaybackDiscovery|getPendingClaimStore`
- `EXPO_PUBLIC_RECOMMENDATIONS_ENABLED`

## What To Build

- Allowlist the eight recommendation operations on the fleet bearer plus
  `x-viewer-id`; never the web-only digest operations.
- A viewer identity store: lazy single-flight bootstrap, 180-day handle
  expiry, one re-bootstrap on rejection with a cooldown for a fresh handle,
  session rotation only with a cryptographic random source, a playback hold.
- Delivery with strict slate validation and a discriminated result; a hook
  with Web's retry cadence and an evidence ledger.
- Evidence, selection and pending-claim helpers with Web's literals.
- A playback episode recorder fed by the single player adapter for every
  session-owning playback: claim from the selection nonce or a playback
  context, strict facts, Web's caps and retry ladder.
- Discovery marks from search results (`search`) and external links (`share`).
- Optional opt-out switch `EXPO_PUBLIC_RECOMMENDATIONS_ENABLED`.

## Constraints

- Never send `sessionDigest`, `consentReceiptDigest` or `profileTokenDigest`.
- Never log a token, capability, nonce, episode id or request id.
- No native module beyond `expo-crypto` (added 2026-09-17 for session
  rotation, by decision). That one moves the fingerprint runtime version, so
  a native build ships before the next `eas update`.
- No Home shelf, no account linking, no content actions (`feat-372`).
- Do not create production identities or playback facts for verification.

## Verification

- `pnpm --filter @forge/mobile test`, `typecheck`, `lint` pass.
- `operations.contract.guard.test.js` validates every document against
  `apps/admin/schema.graphql`.
- `authHeaders.test.ts` pins the allowlist to the documents mobile sends and
  excludes the web-only operations.
- `playbackRecorder.test.ts` pins the fact sequence, caps, batching, claim
  ladder and definitive-failure inertness; `viewerIdentity.test.ts` pins
  bootstrap, expiry, rotation, holds and cooldowns.
- `useManagedVideoPlayer.recommendations.test.tsx` pins the adapter wiring.
- Remaining: a real-environment smoke (bootstrap, `status`, one playback
  episode accepted by Admin) once a provisioned endpoint exists; recorded
  under `feat-517`.

## Results — 2026-09-16

Implemented on branch `worktree-feat-mobile-recommendations-api`. All mobile
suites pass with the typecheck clean. At first the runtime had no
cryptographic random source, so session rotation was inert on device; see
"Session rotation source" below for the fix.

Device smoke on the iPhone 17 Pro Max simulator (dev client, worktree Metro)
against a throwaway local proxy that answered the recommendation operations
with contract-shaped data and forwarded only public reads to production. Two
videos opened by deep link: bootstrap once (bearer and `x-viewer-id` present
on every recommendation call, absent on public queries, no digest argument),
`share` context, claim with the issued nonce, then `playback_attempt`,
`playback_start`, `playback_progress` every 10 s, one
`playback_active_visible_playing` chunk, `playback_observation` and
`playback_end` (`route_exit`, position 40.7 s) on the handover, and a fresh
episode for the second video. Every batch passed payload-shape validation. The
smoke found and fixed one defect: the adapter's initial source swap fires the
`abandoned` session reason, which had ended every episode 19 ms in. No real
Admin endpoint has been exercised.

Reviewed against the consumer handoff guide (14 September) afterwards. Five
refinements landed with tests: a rejected handle is re-verified and replaced
only after a successful bootstrap under the same bearer (never discarded on
`UNAUTHENTICATED` alone); a selection `conflict` receipt is not acknowledged;
the slate's `expiresAt` gates evidence and selection; the episode's
`hardUntil` stops fact delivery; and a profile transition refreshes the slate
through the store's subscription.

### Code review fixes — 2026-09-16

A ten-lens `ce-code-review` round (report and metadata under
`/tmp/compound-engineering-501/ce-code-review/20260916-152511-c0116346/`)
returned "Ready with fixes" with two P1 findings. Applied, each with a test:

- **Seed path (P1).** A recorder created after playback began is now primed
  with the player's live playing state, so a search or Home-tile open records
  `playback_start` and progress.
- **Rate limiter (P1).** Admin's `@envelop/rate-limiter` answers HTTP 200 with
  an `errors[]` entry carrying `extensions.http.statusCode: 429` and no `code`.
  `errors.ts` now maps that (and an edge HTTP 429) to a transient
  `RATE_LIMITED` with the `Retry-After` window. A limited claim waits the window
  once instead of spending an attempt; a limited facts batch pauses the drain
  for the window without spending a delivery attempt (three deferrals, then the
  batch drops and the episode stays open); a limited bootstrap is a cooldown,
  not a `bootstrap_failed`.
- **Dispose (P2).** A disposed recorder no longer retries the claim, falls back
  to a context, or takes the selection nonce and discovery mark a replacement
  recorder needs. A claim already in flight still delivers the held facts once
  (plan R19).
- **Verify backoff (P2).** A suspect handle whose `status` probe failed
  transiently keeps serving and is re-verified no sooner than 60 s later.
- **Typed transport (P2).** `mutateWithDeadline` and `queryWithDeadline` take
  the gql.tada document's own variables and result types; the `as never` casts
  are gone. The fallback deadline timer is cleared on settle.
- **P3s.** A series search result no longer marks a `search` discovery for a
  slug that never keys an episode; `empty` and `fallback` deliveries carry
  Admin's own reason instead of `invalid_delivery`; the hook serves no items,
  evidence or selection while `enabled` is false and keeps a selection
  single-flight across a profile refresh; the fact budget is charged only for
  facts that are queued; the four identity-deps bridges are one helper; the
  abort classifier is shared with the Apollo error link; unknown selection
  receipt statuses are not acknowledged; the store reports
  `session_rotation_unavailable` once per launch.
- **Tests added** for the PiP-release visibility call, the per-kind fact cap,
  the non-`UNAUTHENTICATED` `update()` failure, the live `replaced` session
  path, and `enabled.ts`.

Not done, by decision: per-fact evidence cannot batch across items because the
mutation carries one `itemId` and `capability` per call. Review #18 and the
series-search attribution follow-up landed afterwards; see the two sections
below.

### Series search results attribute their episodes — 2026-09-17 (review #10)

A series search result opens a list, so no episode slug exists to mark when
the tab navigates. The search tab now carries `?from=search`
(`DISCOVERY_ROUTE_PARAM` in `playbackDiscovery.ts`) into the series route, and
the series page marks the tapped episode with the source the param names
(`discoverySourceFromParam`, which accepts `search` only) right before it
navigates. `playbackDiscovery.test.ts` pins the parser and
`app/series/__tests__/seriesSearchDiscovery.guard.test.js` pins both halves
of the wiring at the source, because the series screen has no render suite.

Verified on the iPhone 17 Pro Max simulator against the smoke proxy:
`forgemobile://series/washi-gospel?from=search`, then a tap on "What are
Humans?", produced an `IssueWatchPlaybackContext` with
`discoverySource: "search"` and `provenance: { handoff: "search_result" }`
for that episode's media id; the control, the same page opened without the
param and a tap on "What is sin?", produced `discoverySource: "direct"`.

### Session rotation source — 2026-09-17 (review #18, option 1)

`expo-crypto` (57.0.3) is now a dependency, by decision. `random.ts` tries
the runtime's WebCrypto first and then requires `expo-crypto` lazily, so jest
and module init never touch the native module; a source that throws or
leaves the buffer untouched yields null, never a weaker token.
`random.test.ts` pins both branches and the null cases with the native module
mocked.

Verified on the iPhone 17 Pro Max simulator with a fresh local dev-client
build (`expo prebuild` plus `expo run:ios`; the ExpoCrypto pod linked and the
MMKV define present) against the smoke proxy, through a temporary console
probe that was removed afterwards and the sources restored from byte copies,
with the rotation window shortened to 20 s for the probe only. The app
reported `hasSecureRandom=true` and a 43-character token of Admin's shape.
The user flow then rotated the session for real: open a video (bootstrap,
claim, facts), leave the page, close the floating player (the episode ended
and the playback hold released), idle past the window, read the identity. The
app logged `session_rotated` and its session changed from `XCSMaA…` to
`zjNBxP…`; the proxy logged the `status` call with `rotated: true`, the new
token 43 characters in Admin's shape, the bearer present and the
`x-viewer-id` set. A first attempt that dismissed the session while the watch
page stayed on screen did not rotate: the page claimed a second episode at
once, which held the session again, so the hold works as designed.

Consequence: `expo-crypto` is a native module, so the fingerprint runtime
version moves. A native build must ship before the next `eas update`, and the
production channel is already dark until one does (see `apps/mobile/CLAUDE.md`
"Cold-start splash").

### Timing evidence for the adapter change — 2026-09-16 (review #5)

Measured on the iPhone 17 Pro Max simulator (dev client, the worktree's own
Metro on 8095, the smoke proxy on 3010 answering every recommendation
operation locally). A temporary `console.log` patch timed the three changed
points with `performance.now()`; it was removed afterwards and the adapter was
restored from a byte copy. Two configurations, six deep-link opens each,
alternating `jesus` and `the-birth-of-jesus` with 35 s of playback per open.
The OFF configuration inlines `EXPO_PUBLIC_RECOMMENDATIONS_ENABLED=false`
(verified in the served bundle); the proxy saw zero recommendation operations
during it.

| Measure (JS thread)                               | Feature on                  | Feature off                    |
| ------------------------------------------------- | --------------------------- | ------------------------------ |
| Time to first frame, median (min–max)             | 1,080 ms (902–2,379)        | 1,056 ms (932–1,393)           |
| Recorder creation + start + priming, median / max | 0.1 ms / 2.2 ms             | 0.0 ms / 0.1 ms (null factory) |
| Per-second tick, median / p95 / max (n ≈ 208)     | 11.7 µs / 1.32 ms / 2.30 ms | 2.0 µs / 3.0 µs / 14.6 µs      |

Reading: the added tick work is about 10 µs on an ordinary second and up to
2.3 ms on the one tick in ten that builds and sends a facts batch, both far
under a 16.7 ms frame. Recorder creation costs at most 2.2 ms once per media
session. The TTFF medians differ by 24 ms with the two ranges overlapping, so
no first-frame cost is measurable; the 2,379 ms value is the first open after
the ON reload and is within the dev client's network variance. The proxy
answered in under a millisecond, so these numbers exclude Admin's real latency,
which is asynchronous and never on the tick's path. Five of six opens per
configuration took the seed path (the recorder was created after playback
began and primed with the live playing state).

### Code review fixes, round 2 — 2026-09-17

A second `ce-code-review` round over the finished branch (report and metadata
under `/tmp/compound-engineering-501/ce-code-review/20260917-095317-048a7900/`)
returned "Ready with fixes" with four findings, none P0 or P1. All four are
applied, each with a test:

- **Context issuance ladder (P2).** Every playback that did not start from a
  slate claims through `issueWatchPlaybackContext`, and one transient answer
  there (`RATE_LIMITED`, `TIMEOUT`, `NETWORK_ERROR`) abandoned the whole
  episode. The issuance now has the claim's own ladder: it shares the three
  attempts and the one window deferral, re-checks `dispose()` after every
  wait, and takes the discovery mark once. An issuance already in flight at
  `dispose()` still claims once and delivers the held facts, like a nonce
  claim in flight (plan R19). Six recorder tests pin the ladder.
- **Evidence retry (P2).** A rate-limited render or impression send retried
  100 ms later, inside the same window, and spent a second slot of the shared
  bucket. The one retry now waits the `Retry-After` window (bounded to 60 s).
- **Stale reason (P3).** With `enabled` false the hook returned `idle` beside
  the last delivery's `reason`; both are now gated on `enabled`.
- **Docs pointer (P3).** The conventions note pointed
  `RECOMMENDATION_OPERATION_NAMES` at `authHeaders.ts`; it now names
  `src/lib/recommendations/operationNames.ts`.

Carried as residual risks, not fixed: `invalidate()` keys on the current
record rather than the rejected identity (needs two overlapping rejections;
self-heals after the cooldown); unserialized SecureStore writes from
`touch()` beside a rotation or verify persist (at most one touch persist per
5 min); the selection nonce is consumed before a rate-limit deferral, so a
dispose during that wait loses it (inert until `feat-517` wires `select()`);
`?from=search` and external opens are client-asserted, so Admin must keep
`discoverySource` advisory.

### Close-out checklist — 2026-09-17

Open items that belong to this ticket, not to `feat-517`:

- [ ] **Double recorder on a Home-tile open.** Observed 2026-09-17 in the
      smoke proxy log (`/tmp/feat-516-perf.jsonl`, 22:54, 22:57 and 22:58 UTC):
      each open from a Home tile issued two `IssueWatchPlaybackContext` about
      360 ms apart for the same media; the first claim failed its nonce match
      and shipped a stub episode (`playback_attempt`, `playback_observation`,
      `playback_end` `route_exit` at 0 s) before the real episode began. A
      deep-link open (`forgemobile://watch/<slug>`) issued once. The mechanism
      is not established. Reproduce: play a video, return to Home, tap a tile
      while the floating player is up, then read the log with
      `proxy-window.py`. Trace which dependency of the recorder effect in
      `src/hooks/useManagedVideoPlayer.ts` (`recommendationMediaId`, `player`,
      `readPlayhead`) re-runs, and pin the fix in
      `useManagedVideoPlayer.recommendations.test.tsx`.
- [ ] **Native build before the next `eas update`.** `expo-crypto` moved the
      fingerprint runtime version; an update published before a native build
      reaches no installed build. Push a TestFlight build after merge.
- [ ] **Residual risks** from the round-2 review, listed above: decide per
      item whether to fix in this ticket or record as accepted. The
      selection-nonce item arms only when `feat-517` wires `select()`, and
      `feat-517` carries a constraint for it.
- [ ] **First real-environment smoke** (bootstrap, `status`, one accepted
      episode) is the first step of `feat-517`; until it runs, no real Admin
      endpoint has been exercised.

## Completion

Shipped in PR #2329. The real-environment smoke against a provisioned Admin endpoint stays with feat-517.

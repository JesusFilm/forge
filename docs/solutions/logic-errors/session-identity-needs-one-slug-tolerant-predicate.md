---
title: "Two predicates for one identity: the strict copy in the store ended the playback session the tolerant copy in the host adopted"
date: 2026-09-22
category: logic-errors
module: apps/mobile
problem_type: logic_error
component: frontend_stimulus
severity: high
framework_version: "react-native 0.86.2 (expo 57, react 19)"
symptoms:
  - "Opening a video that was already floating in the mini player (the window's expand tap, the video's own Home tile, or a navigation-stack remount) issued two IssueWatchPlaybackContext mutations about 360 ms apart and restarted the video from 0:00"
  - "The running Recommendation Playback Episode ended with route_exit at its playing position, and a stub episode followed it (playback_attempt, playback_observation, playback_end route_exit, all at 0 s)"
  - "A deep-link open of the same video issued once, so only the in-app re-entry paths doubled"
  - "The playback host adopted the re-entry while the request store rejected it as a replacement, because two modules answered the same identity question with different predicates"
  - "Every existing expand fixture published a resolved video id, so the production first-render shape (a slug-only, id-less request from a route-scoped provider that sets video in an effect) was never pinned and the whole suite stayed green"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - apps/mobile/src/lib/miniPlayer/store.ts
  - apps/mobile/src/lib/miniPlayer/playbackRequest.ts
  - apps/mobile/src/components/watch/PlaybackHost.tsx
  - apps/mobile/src/hooks/useManagedVideoPlayer.ts
  - "apps/mobile/app/watch/[slug].tsx"
tags:
  - mobile
  - react-native
  - mini-player
  - playback-session
  - identity-predicate
  - recommendations
  - video-player
  - fixture-shape
---

# Two predicates for one identity: the strict copy in the store ended the playback session the tolerant copy in the host adopted

## Problem

A watch screen that mounts onto the video already floating in the Mini Player publishes its playback request one commit before its Video record lands, so the first request names the video by slug alone. The request store compared that slug-only descriptor with the live session by a strict key, read one video as two, and ended the session as `replaced`. The single player host then dropped its progress identity, disposed the recommendation episode recorder, reloaded the stream from 0:00, and created a second recorder one commit later, which claimed a second episode for the same media.

## Symptoms

The fake-admin proxy smoke for feat-516 recorded three incidents on 2026-09-16 at 22:54, 22:57 and 22:58 UTC, all on the same media. The feat-516 ticket records the same three timestamps under 2026-09-17, which is their local date. Each incident showed the same sequence.

- Two `IssueWatchPlaybackContext` mutations went out about 360 ms apart.
- The running episode ended with `playback_end`, reason `route_exit`, at its current playing position.
- A stub episode followed it: `playback_attempt`, then `playback_observation` about 290 ms later, then `playback_end` with reason `route_exit` at 0 s.
- The video restarted from 0:00 on screen.
- The first claim failed the proxy's nonce match, because the second issuance had already replaced the nonce.

The trigger was any open of a video that was already floating: the window's expand tap, the video's own Home tile, or a stack remount. A deep-link open on a cold app issued once and behaved correctly.

The healthy signature, recorded the same day, is one `IssueWatchPlaybackContext` with a discovery source, one `ClaimSemanticRecommendationEpisode` with `nonceMatches: true`, then a `RecordSemanticRecommendationPlayback` about every 10 seconds (session history). The count of issuances per open is the signal, and only a log that records every request can show it.

## What Didn't Work

Three hypotheses were tested by reading the source. Each one was ruled out without a code change.

- **A player identity change.** The recorder effect lists `[recommendationMediaId, player, readPlayhead]` as its dependencies (`apps/mobile/src/hooks/useManagedVideoPlayer.ts:294`). If `player` changed, the effect would re-run. It does not change: expo-video's `useVideoPlayer` keys on the serialized source, and the adapter freezes the creation source in a ref, so one adapter instance holds one stable player. `ActivePlaybackHost` is unkeyed, so React does not force a new instance either. That left two ways for the effect to re-run: the media id goes X -> null -> X, or the whole host remounts.
- **A null blip in the request store.** The theory was that `build()` briefly returned no request while the screens swapped. Reading the builder ruled it out: it returns the newest admissible slot, or the retained request of a departing screen (`apps/mobile/src/lib/miniPlayer/playbackRequest.ts:338`), so the request does not fall to null during the swap.
- **A stale video in a shared watch session.** The theory was that a provider higher in the tree held an old record. The provider mounts inside the watch route group (`apps/mobile/app/watch/_layout.tsx:32`), so it dies with the route and cannot carry a stale video across.

Two earlier passes over this code did not find the defect either (session history).

- **The flip was seen and read as a seeding fault, not an identity fault.** On 2026-09-16 the feat-516 session's review validator cited the host comment that already documented "flipping videoId null -> documentId mid-playback". The session asked "why does this recorder miss `playback_start`?" rather than "why is there a second recorder?", and shipped a priming patch: a recorder created after playback began is seeded with the player's live playing state. The priming was correct for the seed case and left the second recorder intact. A comment that states a surprising mid-playback mutation is a prompt to ask what else keys on that value.
- **A green suite and two adversarial review rounds did not see it.** The recorder's own tests inject one stable media id, so no unit test can produce a second recorder. The round-2 testing persona returned zero findings and reasoned about the recorder in isolation from the host that mounts it. PR #2329 went green with the defect intact, and the defect was found only in the device-side request log.

## Solution

The fix makes one slug-tolerant identity predicate serve every place that asks "is this the same video", and it makes the host hold the last identity it resolved for the same slug.

Before the fix, the store keyed identity by whichever field was present. A slug-only descriptor and an id-bearing session could never match.

```ts
// sessionIdentityKey in apps/mobile/src/lib/miniPlayer/store.ts before PR #2376 (removed)
return session.videoId ? `id:${session.videoId}` : `slug:${session.videoSlug}`
```

The tolerant predicate already existed. It lived in `playbackRequest.ts`, beside the strict key, and only the host read it. The fix moved it unchanged into the module that owns the session (`apps/mobile/src/lib/miniPlayer/store.ts:104`):

```ts
export function sameSessionContent(
  a: Pick<MiniPlayerSession, "videoId" | "videoSlug">,
  b: Pick<MiniPlayerSession, "videoId" | "videoSlug">,
): boolean {
  if (a.videoId != null && b.videoId != null) return a.videoId === b.videoId
  return a.videoSlug === b.videoSlug
}
```

Three call sites changed to read that one predicate. A fourth reader already used it: the play-to-end guard that marks the session ended (`apps/mobile/src/components/watch/PlaybackHost.tsx:1294`) only moved its import. `sessionIdentityKey` and its unit test were deleted.

A fourth strict compare stays strict on purpose. `sameSession` (`apps/mobile/src/lib/miniPlayer/playbackRequest.ts:259`) answers "did this request change", not "is this the same video". It must keep `videoId === videoId`, because the slug-only render and the id-bearing render that follows it are a real change the host must see. Do not convert it to `sameSessionContent`.

1. **The replacement check** in `apps/mobile/src/lib/miniPlayer/playbackRequest.ts:366` compares `sameSessionContent(next.session, session)`. Before, it compared the two strict keys, so `slug:<slug>` never matched `id:<id>`.
2. **The re-start merge** in `start()` decides "merging" with the same predicate and keeps the known id when the new input carries none (`apps/mobile/src/lib/miniPlayer/store.ts:191` and `:194`). Before, the merge decision also used the strict key, and the field was `videoId: input.videoId`, so a slug-only re-start erased the id even when it merged.

   ```ts
   const merging = previous != null && sameSessionContent(previous, input)
   const session: MiniPlayerSession = {
     videoId: input.videoId ?? (merging ? previous.videoId : null),
   ```

3. **The host's adoption check** uses the same predicate (`apps/mobile/src/components/watch/PlaybackHost.tsx:353`). Before the fix, the host was the only reader of the tolerant predicate.

The host also holds the last resolved progress identity for one slug. `holdProgressIdentity` (`apps/mobile/src/components/watch/PlaybackHost.tsx:178`) returns the known identity when the published one is null, when the published one is slug-only over a known id, or when the published one carries the same id with a null dub over a known dub. Otherwise it returns the published one. The host keys the ref on the slug-stable `videoKey` (`:385`) and writes it only when the identity changes (`:404` to `:409`), which mirrors the existing `loadedSourceRef` rule for the source.

The adversarial review then added one more guard. `validateLocalMediaUrl` returns a boolean: true only for a `file:` URI inside the offline download root. The host asks that question of the loaded URL and of the requested URL, so `containerChanged` is true only when one is a local download and the other is not, never on an ordinary URL change. The host passes `adoptable && !containerChanged` into the source picker (`apps/mobile/src/components/watch/PlaybackHost.tsx:361` to `:370`):

```ts
const containerChanged =
  loadedUrl != null &&
  request.streamingUrl != null &&
  validateLocalMediaUrl(loadedUrl, OFFLINE_ROOT) !==
    validateLocalMediaUrl(request.streamingUrl, OFFLINE_ROOT)
```

## Why This Works

The root cause is one identity question answered by two predicates in two modules. The watch screen's first render publishes `session.videoId: null` and `progressVideoId: null` with the slug, because the group-scoped `WatchSessionProvider` sets `video` in an effect one commit later. The descriptor is built at `apps/mobile/app/watch/[slug].tsx:719`, and `progressIdentity` at `:730` answers null when `video?.documentId` is absent and the video is not offline. So the production first-render shape is slug-only, by construction.

The strict key turned that shape into a different video. `end("replaced")` ran, the adapter ended the episode, the retained request dropped, the session became null, the host's `adoptable` became false, and the seed stream reloaded from 0:00. `progressIdentity` went null, so `recommendationMediaId` went null (`apps/mobile/src/hooks/useManagedVideoPlayer.ts:266`), and the recorder effect tore down and disposed its recorder. One commit later the record landed, the id returned, the effect re-ran, and a second recorder issued the second context.

The diagnosis method was the proxy log's neighbors, not the mutation itself. Each of the three incidents was bracketed by a `GetWatchSetting` query and then a `GetExperienceBySlug` query. That pair is the experience shell resolving its slug from nothing (`apps/mobile/src/contexts/ExperienceShell.tsx:39` to `:53`), which swaps the rendered element type and remounts the whole navigation stack. The host is a sibling of the shell (`apps/mobile/app/_layout.tsx:467`), placed there so the player outlives the route. The bracketing queries identified the remount; the `route_exit` at a playing position identified the ending; the stub episode identified the second recorder. The lapse-reminders planning session had already recorded that this shell swap remounts the navigation stack, so any identity predicate must survive that swap and not only a Mini Player expand (session history).

The fix addresses the cause because the slug-tolerant predicate accepts the id-less shape as the same video. The session survives, the retained request survives, `adoptable` stays true, the loaded URL is reused, and the held identity keeps `recommendationMediaId` stable, so the effect never tears down.

The adversarial reviewer then constructed the second-order effect. Because the session now survives the remount, `adoptable` stays true for the whole expanded viewing, and `sourceForRequest` returns the already-loaded URL on any same-language URL change (`apps/mobile/src/lib/miniPlayer/playbackRequest.ts:189` to `:202`). A download that completes during the viewing changes the URL from `https` to `file://` with the same language, so the new local container would have been swallowed. The `containerChanged` check routes a local-remote flip through the pin, so the player receives the new container.

Per this session's conclusion, the warm remount's own trigger is not established: why `GetWatchSetting` and then `GetExperienceBySlug` fire on a warm app is still open. It is recorded as an open item in `docs/roadmap/content-discovery/feat-516-mobile-recommendations-api-client.md`.

## Prevention

- **One identity predicate across the store and host seam.** A store and its host must not each hold their own answer to "is this the same content". Export one predicate from the module that owns the state, and make the replacement check, the merge, and the consumer's adoption read it. The `apps/mobile/CLAUDE.md` mini-player section now carries this as a bullet ("One identity predicate: `sameSessionContent` in `store.ts`"), and `docs/roadmap/platform/feat-367-mobile-mini-player.md` names it at entry point 6.
- **Fixture shape must match the producer's first render.** This is a new instance for the META doc's worked-instance table. Every pre-existing expand fixture published a resolved video id, so no test could see the production shape. Write at least one fixture in the id-less shape the producer emits on its first render: a session descriptor by slug alone, and no progress identity at all. The pinned shape in `apps/mobile/src/hooks/__tests__/useManagedVideoPlayer.recommendations.test.tsx:652` is `request(URL_A, { videoSlug, languageSlug: null })` spread with `progressVideoSlug: null`.
- **Falsify per gate, not per feature.** This is the feat-327 fixture-helper trap recorded in `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`. Here the helper derives `session.videoId` and `progressVideoId` from one identity argument, so it flips the store's gate and the host's gate together, and an integration case can pass while one gate is dead. Keep a per-gate pin in the store suite and in the host suite, and falsify each gate once by stubbing it and watching its own pin go red. The suites that hold these pins are `apps/mobile/src/lib/miniPlayer/__tests__/store.test.ts`, `apps/mobile/src/lib/miniPlayer/__tests__/playbackRequest.test.ts`, `apps/mobile/src/components/watch/__tests__/PlaybackHost.test.tsx`, and the recommendations suite above. That last suite holds the pin the review asked for: a different video's id-less publish must re-key, which keeps the `videoKey` scope honest.
- **Removing a spurious reset engages dormant pins.** When a fix stops a state from being torn down, audit every path the old teardown used to refresh. The old `replaced` ending re-read the source on each remount, which hid a stale-container path behind the adoption pin. Removing the reset made that path live, and the `containerChanged` guard covers it now. Ask, for each removed reset, what it was incidentally refreshing.
- **A mid-playback flip comment is a prompt, not an answer.** When source documents a value that changes mid-playback, list every effect and predicate keyed on that value before choosing a fix. The earlier priming fix treated one consumer of the flip and left the other (session history).
- **Read the request log's neighbors.** A stack remount shows up in the device-side log as the shell's own queries around the incident. Read the requests before and after a suspicious mutation, not only the mutation.

**Verification set.** The fix ran the full mobile jest suite green (270 suites, 4340 tests), plus `tsc`, `eslint` and `prettier`. A simulator smoke on an iPhone 17 Pro Max against the fake-admin proxy confirmed the behaviour: an expand and a same-slug deep-link re-open sent no issuance, no claim and no episode end, and the player kept its position. With the strict compare stubbed back in, the expand ended the episode with `route_exit` on the device.

**Residuals accepted.** A replay after play-to-end opens no new episode, which is pre-existing. `holdProgressIdentity` compares ids with `===`, so two slug-only identities read as one inside the helper. The `videoKey` derivation at `apps/mobile/src/components/watch/PlaybackHost.tsx:385` keys the ref per slug, so the helper never sees two different videos. Verified by reading that expression on 2026-09-22; re-check that expression before you trust this line. A slug-only merge overwrites the session's `languageSlug`, which nothing reads. Alias slugs still read as a replacement until the record lands.

## Related Issues

- PR #2376 opened this fix on 2026-09-22 and is unmerged as of this writing. It sits on top of PR #2329 (feat-516, the recommendations API client, merged 2026-09-17) and unblocks the draft PR #2367 (feat-517, the recommended shelf). `apps/tv` has no `miniPlayer` directory, so there is no sibling copy to port.
- `docs/solutions/developer-experience/mobile-write-path-smoke-via-fake-admin-proxy.md` recorded this defect as an open item with the mechanism unknown, and is the diagnostic instrument the fix was found with. This doc resolves that open item.
- `docs/solutions/logic-errors/layout-effect-commit-lag-mini-player-shrink-flash.md` is the same law in the same component. A value that lands in the next commit leaves an intermediate render that needs its own answer. There the lagging value was the layout effect's own state. Here it is the route's Video record, and `holdProgressIdentity` is the intermediate render's answer.
- `docs/solutions/runtime-errors/mini-player-playbackrequest-identity-compare-render-loop.md` is the previous identity defect in the same slot-to-host channel: a field compared by reference, not two predicates that disagree.
- `docs/solutions/logic-errors/occluding-layers-must-share-one-gate-predicate.md` carries the same rule: two gates agree on the happy path and diverge where it matters, and one shared predicate fixes both.
- `docs/solutions/best-practices/shared-predicate-partial-rollout-gap-20260810.md` carries the complementary step: exporting one predicate does not remove the hand-rolled compares that already answer the same question. Grep the module for the shape the predicate replaces, then classify each hit as a call site or as a deliberate exception. See the `sameSession` exception above.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` is the META home for the fixture trap here: fixtures pinned a resolved id the production first render never produces.
- `docs/solutions/logic-errors/react-strictmode-remount-safety-hook-lifetime-refs.md` is adjacent by the word "remount" only. Its trigger is a dev StrictMode cycle on one hook instance; this defect is a production stack remount that mounts a fresh screen onto a live module-scope session, so a StrictMode suite is not the detector here.
- Open item: the warm experience-shell remount's trigger, tracked in the feat-516 roadmap ticket.

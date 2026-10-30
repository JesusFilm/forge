---
title: "Verify TV fault routing and visible native controls before judging recovery"
date: "2026-10-19"
category: integration-issues
module: "apps/tv — selected branch integration (feat-749)"
problem_type: integration_issue
component: testing
severity: medium
tags: [tv, expo, metro, avkit, android, testing, recovery]
---

# TV integration verification lessons

The selected integration combines recovery/network/configuration (02), Android
track pickers (07), Home typography only (08), and environment tests only (12).
The baseline merges current TV/harness commit `11103c5e3` onto main `42cf25b3d`.
See `docs/plans/2026-10-19-tv-selected-integration.md` for acceptance and limits.

## Confirm the actual network destination

Running a second Metro server with an `EXPO_PUBLIC_GRAPHQL_URL` process override
did not establish the intended fault endpoint in this session. The downloaded
bundle contained the proxy URL once, but its `_expoVirtualEnv` module still held
the normal endpoint. The app bypassed the fault proxy and displayed real language
results. Clearing Metro's cache alone did not fix this condition.

For a controlled local fault test:

1. Stop the normal server before changing its ignored local configuration.
2. Privately back up `.env.local` byte for byte; never print its credentials.
3. Set the endpoint in the ignored local file, restart Metro, and check the
   emitted virtual environment value, not merely a substring anywhere in a bundle.
4. Confirm actual app operations arrive at the proxy before judging the UI.
5. Restore the exact original bytes, remove temporary fault routes, restart the
   normal server and verify Home again.

The successful series test used only real `GetSeriesLanguages` responses, with
local 503 failures followed by real upstream data. Android preserved the typed
query through Retry. Apple displayed loading, recovered its real language list,
and restored action focus after Close. A temporary render-fault route also proved
root Try again returns to populated Home on both TV targets; it is not shipped.

## Hidden AVKit accessibility is not a clock oracle

On the Xcode 27.1 / tvOS 27.0 simulator, `AXElapsedTime` remained accessible with
the same value while archived screenshots showed different film frames and no
visible playback controls. Sending Down and resolving a fresh query did not
establish visible controls. This does not prove AVPlayer time is frozen.

The Native A Swift implementation and React wrapper were unchanged by this
integration. It uses AVKit controls; its custom elapsed labels apply to Native B.
Keep failed automation evidence and mark pause/resume/Back unverified when the
clock assertion prevents those steps. Do not turn a hidden accessibility node,
a moving film screenshot or a successful build into a playback-controls pass.
The task retains this remaining verification in feat-749.

## Preserve cancellation and picker request ownership

Transient network retries must remain query-only. Abort during retry backoff
must terminate the subscription immediately, not merely prevent the next fetch.
Tests exercise real link subscriptions and fake timers for that boundary.

Each native picker request owns its updates, result and cleanup. Retry returns
the current search query before reopening; obsolete requests cannot dismiss or
overwrite a newer dialog. Series hero loading and language loading are separate
queries and must supply separate loading/error/refetch state to the panel.

## Keep performance comparisons explicit

Alternate baseline/candidate launches on one target and APK/native app. State
that content/storage/image caches are retained and UI observation adds overhead.
The recorded small Debug samples are smoke checks, not production benchmarks.
Match screen-recording conditions when comparing emulator video rendering.

## Linux Jest Modal boundary

The PR's Linux runner attempted to initialize the native Modal presenter through
React Native's default Jest mock and failed with `__fbBatchedBridgeConfig` absent.
A component test that only inspects the panel's element tree should explicitly
mock the `react-native/Libraries/Modal/Modal` host boundary. Preserve the real panel
logic and loading/error/retry/empty/focus assertions; do not supply fake bridge
configuration or weaken those assertions. Native presentation remains covered by
separate simulator evidence. The focused suite and cold-cache full suite pass
locally; CI is the authority for the Linux environment.

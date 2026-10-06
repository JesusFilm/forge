---
module: tv
tags: [tvos, android-tv, top-shelf, expo-router, deep-link, autoplay]
problem_type: runtime_error
date: 2026-10-05
---

# Top Shelf cold links and preferred audio selection

Warm Top Shelf links opened the correct video, but a closed Expo development
build returned to Home after selecting its development server. The native
development launcher preserves the pending link in React Native launch options.
Expo Router 6 uses Expo Linking's registry on iOS, which can instead contain only
the root URL during this handoff.

Use the supported root `+native-intent.tsx` hook. For an initial tvOS root launch,
read React Native `Linking.getInitialURL()` and recover only validated application
Top Shelf destinations. Keep explicit destinations, normal Home launches, warm
links and Android routing unchanged. A second root navigation listener can
accidentally replay stale launch URLs.

Cold Play also revealed that the shared watch session publishes video metadata
before its default-dub effect selects the preferred language. Treat a playable
preferred dub with a temporarily different active dub as **waiting**. Fall back
to Details only when the requested language has no playable variant.

Verify closed-app More Info and Play separately from warm navigation. Development
build QA includes selecting the correct Metro server; verify beta Release builds
independently. Record the actual title, progress and Back behavior rather than
treating unit tests or the App Group snapshot as navigation proof.

Reference: [Expo Router native intent](https://docs.expo.dev/router/advanced/native-intent/).

## Repeated Google TV Play links

Bundled Android Release QA exposed a different warm-link failure. After pausing
JESUS and returning to the launcher, the same `watch/jesus?autoplay=1` URI brought
the existing route forward without rearming its consumed autoplay state. Playback
stayed paused and its recreated surface could remain black.

The focused watch route now handles each validated same-video external Play URI,
not only links carrying the Apple `topShelf` marker. Reset the autoplay latch and
phase before dismissing the old player, then let the existing resume flow create
the requested playback session. Ordinary details URLs remain inert; Top Shelf
More Info still dismisses playback without starting it. Reject different routes,
credentials, fragments and duplicate control parameters.

Verify the hot case from a genuinely settled launcher, not immediately after
sending Home: Google TV's own Home transition can otherwise move the app back to
the background after a rapid automation launch. The repaired ARM32 Chromecast
Release QA hot-link test resumed the saved 5:19 position with a visible frame and
Play/Pause focus. Keep production launcher placement and approved signing separate
from this local release-mode navigation proof.

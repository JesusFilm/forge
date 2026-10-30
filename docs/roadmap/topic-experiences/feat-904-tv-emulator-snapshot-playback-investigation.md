---
id: "feat-904"
title: "Investigate retained Android emulator snapshot and capture instability"
owner: "ekkasit"
priority: "P2"
status: "not-started"
start_date: "2026-10-29"
duration: 2
depends_on: []
blocks: []
tags: [tv, android, testing, playback, emulator]
---

## Problem

A restored Android emulator snapshot produced an isolated duplicated/scaled
video frame during a 720p recording, later screenshot stalls on both unchanged
main and candidate, and an 80-minute guest-clock drift that broke OCSP validation.
Cold boots with the same preserved data eliminated the observed degradation:
the reversed candidate/main comparison and a fresh 720p recording were clean.
No candidate application regression was established; the exact driver/capture
cause of the isolated frame remains unknown.

This tracks retained operational evidence, not a deferred required check for
feat-890. The valid cold-runtime playback comparison and feat-903 Back repair
passed. Historical whole-startup work remains separately open in feat-889.

## Entry Points and Evidence

- `docs/validation/tv-reviewed-shortlist-20261029/README.md`
- `docs/solutions/ui-bugs/tv-reviewed-shortlist-20261029.md`
- `apps/tv/modules/native-android-player/android/src/main/java/expo/modules/nativeandroidplayer/NativeAndroidPlayerView.kt`
- Owned build workspace evidence:
  `/Users/up/.codex/worktrees/tv-streaming-ux/tv-app/.local-tools/merge-readiness-20261029/`
- `frame-artifact-assessment.json` records 71 artifact hashes, timings, exact
  recording frames, emulator flags and restoration. SHA-256:
  `ebaeb0e11e81f92730ea9f07a845c252bc38f8131591d789819f16629d937496`.

## Investigation Constraints

Inspect the retained original recordings and logs before adding another trial.
Separate restored VM memory from preserved user data, and compare host/guest
clocks before judging media delivery. Use one device controller and bounded
recordings. A cold process/app launch is distinct from a cold emulator boot.
Compare captured surfaces at the same film position, not only the same elapsed
test second. Do not infer adaptive video resolution from a rectangle's size
without corroborating decoder/format evidence.

Do not change production rendering or weaken TLS validation to make this
environmental observation disappear. Physical Chromecast installation remains
deferred; testing there requires the owner to resume that work. Preserve data,
signing, existing integrations and all failed evidence.

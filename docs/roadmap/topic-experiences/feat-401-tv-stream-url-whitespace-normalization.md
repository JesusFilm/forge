---
id: "feat-401"
title: "TV stream URL whitespace normalization"
owner: "ekkasit"
priority: "P0"
status: "complete"
start_date: "2026-08-21"
duration: 1
depends_on: []
blocks: []
tags:
  - "tv"
  - "playback"
  - "hls"
---

## Problem

The production `JESUS` video's plain-English HLS value ends with a newline. TV
accepts that raw value because WHATWG `new URL()` removes outer whitespace while
checking the Mux hostname, then passes the original string to `expo-video`.
tvOS requests a `%0A`-suffixed Mux URL, receives HTTP 400, and enters the
terminal playback-error screen when a viewer changes from English, North
American Indigenous to English.

The equivalent mobile ingestion path already normalizes this data. TV needs the
same boundary so one malformed CMS value cannot break initial playback, live
language switching, or later source consumers.

## Entry Points — Read These First

1. `apps/tv/src/lib/validateUrl.ts` — Mux URL allowlist; currently validates but does not return a cleaned value.
2. `apps/tv/src/lib/normalizeVideo.ts` — projects raw dub HLS values into `variants` and `streamingUrl`.
3. `apps/tv/src/components/watch/useSessionPlayback.ts` — sends the normalized active dub to `replaceAsync`; its switching behavior is not changing.
4. `apps/mobile/src/lib/validateUrl.ts` and `apps/mobile/src/lib/normalizeVideo.ts` — shipped `cleanStreamUrl` precedent.
5. `docs/solutions/integration-issues/mobile-hero-stream-url-trailing-whitespace-validation-gap.md` — production evidence and the validate/use mismatch.

## Grep These

- `validateStreamingUrl`
- `hls: v.hls`
- `streamingUrl: firstPlayable`
- `replaceAsync(target)`
- `cleanStreamUrl`

## What To Build

1. Port `cleanStreamUrl` to `apps/tv/src/lib/validateUrl.ts`: trim outer whitespace, reject empty values, and reject any remaining interior whitespace.
2. Clean each published variant's HLS during TV video normalization.
3. Choose `streamingUrl` only from a cleaned playable variant and return the cleaned value.
4. Add regression tests for a trailing newline, whitespace-only HLS, and interior whitespace.
5. Demonstrate `/watch/jesus` in the Apple TV simulator: play English, North American Indigenous, switch to English, and confirm playback continues without the error screen.

## Constraints

- Keep the change inside `apps/tv`; do not modify Admin data or mobile.
- Preserve the `stream.mux.com` host allowlist.
- Do not change language identity, row ordering, player retry behavior, or the single-player source-switch architecture.
- Validate and play the same cleaned string; never validate one value and send another to the native player.

## Verification

- `pnpm --filter @forge/tv exec jest src/lib/validateUrl.test.ts src/lib/normalizeVideo.test.ts --runInBand`
- `pnpm --filter @forge/tv exec tsc --noEmit`
- `pnpm --filter @forge/tv exec eslint .`
- Apple TV simulator: `/watch/jesus` switches from English, North American Indigenous to English; the player reaches ready/playing, time advances, and no `Playback failed` state appears.
- Capture a simulator screenshot showing English active during successful playback.

## Resolution

Completed 2026-08-21. TV now cleans CMS HLS values before selecting or exposing
playback variants. Regression coverage includes outer-whitespace cleanup plus
whitespace-only and interior-whitespace rejection. The 1080p Apple TV simulator
successfully switched `JESUS` from English, North American Indigenous to English;
English continued playing with the clock advancing and no playback error.

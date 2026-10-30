---
title: "Confirm native TV language switches across different video editions"
module: "apps/tv"
problem_type: "ui_bug"
component: "native audio language selection"
date: "2026-10-28"
tags: [tv, android, apple-tv, playback, language, video-edition]
---

# Watch TV dub-switch edition investigation

Date: 2026-10-28. Track A of feat-889. Base: `c46657d0f`.

## Finding

The 18:22 comparison uses two different cuts of JESUS. A read-only public
GraphQL request returned HTTP 200, no GraphQL errors, and 2,309 dubs for Video
`cmp76xcw602imny01vnsbwwy9` (Core `1_jf-0-0`).

| Audio language                     | Dub ID                                 | Edition ID                  | Edition name | Duration |
| ---------------------------------- | -------------------------------------- | --------------------------- | ------------ | -------- |
| English, North American Indigenous | `8c7a2e70-c1df-4f33-8133-2b61219e9915` | `cmp722p2707sfo001piphemoe` | `jl`         | 7,304 s  |
| Thai                               | `03c0ab4f-8a74-4a24-9a36-732180f3a9af` | `cmp71zmk2076lo001oo2174vh` | `ot`         | 7,674 s  |
| English                            | `3d6bf563-ef8a-4b73-ba1b-41adeff07a81` | `cmp71zmk2076lo001oo2174vh` | `ot`         | 7,674 s  |

All three point to different Mux playback assets. Their public playback IDs are:

- Indigenous English: `M02i6Y98GpwVwmY6cRFSpmQMMYgvnfKa2S2Edfr87N008`.
- Thai: `NJa2wSJd4A6eOjdsyEoOclwAv4hj1sGUwiCFS2nruVY`.
- English: `Dl8dRUL01MKAdzv7XtfvvUj1jVYq029z2TS9TGeH8Xj00o`.

The schema describes VideoEdition as a cut whose subtitle timecodes apply to its
dubs. It does not expose a cross-edition story-time mapping. Native Android
preserves `player.currentPosition` and `player.playWhenReady` during source
replacement. Keeping the same elapsed second was working; treating that second
as an equivalent scene across these two editions was not justified.

## Bounded correction

The TV bulk dub query now requests only `videoEdition { id }`, and the normalizer
carries that canonical identity. Different known edition IDs attach a warning
to the native in-player audio choice. A native Continue/Cancel prompt appears
before the choice emits an audio-change event. Cancel or Back keeps the current
language, list/query and playback state. Continue retains existing position and
pause behavior; the message explicitly says the scene may differ at that time.

Same-edition choices have no extra prompt. Missing identity is classified as
unknown, never as proven same edition. Legacy behavior remains for unknown
identity; no timeline equivalence is promised. No duration ratio, guessed offset,
subtitle-based guess, schema change or metadata mutation is used. This does not
claim semantic scene alignment for different editions.

The correction applies to the default native Media3 and Apple Native A/B
in-player choice lists. Detail-page selection does not show this prompt before
playback. The existing React fallback source-switch behavior is not changed.

## Payload and request evidence

Two alternating samples per case used the same public JESUS dub fields as the
lean TV bulk list, with only `videoEdition { id }` differing. No bearer values
or signed URLs are recorded.

| Case           | Decoded JSON | Locally gzipped JSON | Observed transfer bytes | Total request time |
| -------------- | ------------ | -------------------- | ----------------------- | ------------------ |
| Baseline 1     | 836,752 B    | 231,274 B            | 231,663 B               | 2.095 s            |
| With edition 1 | 952,235 B    | 233,227 B            | 233,808 B               | 2.037 s            |
| Baseline 2     | 836,752 B    | 231,274 B            | 231,402 B               | 0.704 s            |
| With edition 2 | 952,235 B    | 233,227 B            | 233,432 B               | 0.935 s            |

The deterministic decoded delta is 115,483 B (13.8%); gzip delta is 1,953 B
(0.84%), because many dubs share an edition. Two network samples do not establish
latency equivalence. The new field uses the existing Prisma relation projection;
there is no per-dub consumer request. Full integrated screen-ready timing remains
a separate acceptance check.

## Verification

- TV typecheck: passed.
- TV lint: passed.
- Focused Jest edition-policy and normalizer suites: 56 tests passed.
- Kotlin pending-choice lifecycle: 4 JUnit tests passed against
  `NativePlayerState.kt` using the cached Kotlin 2.0.21 compiler and JUnit 4.13.2.
- Swift pending-choice lifecycle: 4 cases passed, compiled from
  `NativeChoiceConfirmation.swift` and
  `tests/NativeChoiceConfirmationTests.swift` with `xcrun swiftc`.
- Native player feature/source-switch guards: 33 tests passed.
- Native builds and visible Continue/Cancel behavior on both devices: pending
  integrated verification by the parent task. Unit tests do not establish native
  alert focus, subtitle rendering, sound or real-device latency.

The native lifecycle helpers cover deferred commit, explicit acceptance,
cancellation, one-shot resolution and replacing a stale pending choice. Native
selection callbacks also reject changes after the original selected audio or
source has changed, so a delayed confirmation cannot target an unrelated session.

## Integrated runtime evidence

The integrated Apple and Android clients show the native warning before known
cross-edition selection. Cancel retains the picker query and current audio;
Continue preserves the elapsed timestamp and paused state while acknowledging
that the scene can differ. Same-edition English/Thai choices avoid a warning.
Apple visibly held paused 10:40; Android visibly held 18:38. Native hidden
accessibility values can read 00:00 during a source handoff; reveal the controls
and inspect delayed visible frames before diagnosing a playback reset.

For native picker ownership, a queued dismissal is not a completed dismissal.
The detail picker must survive until UIKit's presentation and dismissal
completion callbacks finish. Retain it in these bounded transition callbacks;
keep persistent navigation/result callbacks weak to avoid a lasting cycle.
The integrated ARC probe reproduces the original lost-owner case and confirms
one completion and subsequent release after the correction.

---
id: "feat-828"
title: "Show real audio waveforms in Studio timeline blocks"
owner: "tataihono"
priority: "P2"
status: "complete"
start_date: "2026-10-20"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, ui]
---

## Scope

Real waveform previews for linked source audio and independent audio assets.
Manager-only authenticated `/api/shorts/waveform` resolves current source
eligibility or project/retained asset access, stages bounded media locally and
uses the configured FFmpeg to decode only the selected range into mono PCM.
`audio-waveform.tsx` lazily requests numerical peaks for visible audio blocks
and draws SVG. Playback remains the original player stream.

## Constraints

No fake waveform data, duplicate playback, document/schema changes or production
deploy. Source downloads reuse approved-host, byte-bounded broker code and strict
HLS parsing. FFmpeg reads local files only. Bound transfer, duration, execution,
concurrency and cache. Missing codec/audio yields a visible unavailable state.
Keep work outside initial page load and don't refetch on playhead/zoom/moves.

## Verification

Unit-test real PCM peak calculation, cache identity and waveform geometry; test
source authorization, selected segment ranges, asset access and failure paths.
Real-source extraction and uploaded-audio extraction; browser-check full-width
SVG, muted appearance, trims/moves and loading timing. Scoped lint/typecheck/
format and relevant editor tests. FFmpeg already provisioned by root nixpacks;
document this preview consumer in Manager CLAUDE.md.

## Outcome

Implemented real 256-bin PCM peak previews for source footage and retained audio.
Validated all five real source clips and the independent audio asset: each
produced 256 populated bins in 1.1–1.6 seconds without duplicate playback.
Browser verification used those real peak results in the actual Timeline with a
disposable editing session; both source and standalone SVGs filled their blocks.
Muting dims but preserves the source waveform and doesn't request it again.

The combined focused suite passes 28 tests; scoped lint/typecheck/format pass.
The waveform route rejects unauthenticated requests. Preview host configured
with its existing FFmpeg binary, leaving production configuration unchanged.
Loading trace: page load 460 ms; waveform requests first start at 667 ms, after
load. Two audio blocks issue two waveform requests; seeking, timecode mode and
mute changes add none. Source decoding remains separate from browser playback.

Durable rule: cache source-range peaks only after current eligibility/access
checks, and decode staged files with a file-only FFmpeg protocol whitelist.
Silence is measured zero PCM, not an invented waveform. Display uses a square-root
amplitude scale for readability in compact lanes; muted clips retain their shape.

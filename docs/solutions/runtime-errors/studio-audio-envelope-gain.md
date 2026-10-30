---
title: "Studio timeline audio envelopes and gain above unity"
date: "2026-10-20"
module: "Studio audio"
problem_type: integration_issue
component: frontend
root_cause: wrong_api
resolution_type: code_fix
severity: medium
tags: [studio, audio, remotion, timeline, render]
---

# Studio audio envelopes and gain above unity

`packages/studio-contracts/src/audio.ts` owns the envelope used by timeline
presentation and `packages/shorts-compositions/src/studio/Composition.tsx`.
Pass clip-relative timeline frames (`globalFrame - item.startFrame`), independent
of source-in and playback speed. Fade-out reaches zero on the last clip frame.
Optional `audioFade` fields leave legacy items unchanged. Effective fades shrink
proportionally if a later trim makes their combined lengths exceed the clip.

The stored `volume` remains linear amplitude: +30 dB is `10 ** (30 / 20)`;
zero means exact silence. Remotion's regular browser media volume clamps at 1.
Enable `useWebAudioApi` and anonymous CORS on preview media to use its GainNode
for levels above unity. Keep final rendering on the same envelope helper.
Measured quiet-tone playback produced the expected 31.6x gain; actual Studio
WAV rendering measured 29.98 dB relative to a unity render, with half-level
linear fade midpoints. Mono-to-stereo conversion can alter absolute channel RMS,
so compare exports with matching channel layouts when checking gain.

`audio-clip-controls.tsx` keeps pointer drafts local and commits once per gesture
for undo. Stop child pointer events so fade controls cannot also move/trim their
parent clip. Cancellation and lost capture discard drafts. Linked source audio
edits the existing video item rather than creating another sound item.

Envelope edits must preserve `previewSignature` and prepared media references;
they must not refetch thumbnails, metadata or waveform data. Keep controls above
trim hit areas while leaving the clip footer and outer edges available to trim.

Admin validates composition JSON with the same neutral contract. Deploy matching
Manager, Admin and renderer revisions through the normal PR-to-main flow before
expecting new envelope fields to save against a hosted Admin.

## Fade presentation and two-axis dots (2026-10-20)

Render fade shading in normalized full-height gain space, independent of the
straight volume line. Multiplying the visual fade by the displayed volume makes
shading collapse near the bottom of the clip and hides the removed region.
Playback still multiplies the envelope by the stored clip gain.

Optional `fadeInCurvePosition` / `fadeOutCurvePosition` move each curve dot in time
(0.05–0.95, legacy default 0.5); the existing curve parameter controls height.
`audioFadeProgress` remaps progress smoothly around that position before applying
its exponent. At the legacy midpoint the remapping is the identity. Fade-out
progress runs backwards, so horizontal pointer/keyboard direction must reverse.
The same helper drives timeline shapes and preview/export audio.

Avoid native instructional `title` text on clip controls and their parent audio
clip. Accessible slider names/values remain. The centered `<output>` readout was
removed: generic editor output styles overrode its appearance and produced an
unwanted box inside the clip.

Fade shade paint must use fixed palette black (`#080808`), rather than
`--ds-black`: that semantic ink token becomes light in dark mode and would
brighten the removed audio region. Verified the same dark computed fill in both
themes.

## Read-only media admission compatibility (2026-10-20)

A hosted Admin with the previous composition schema rejects `preview-sources`
requests containing `audioFade` or linear gain above 2. Sending the full edited
document to this read-only boundary caused footage/waveform HTTP 400 and browser
preview HTTP 422. The unchanged saved document succeeded; adding either new
presentation field reproduced `INVALID` against the live service.

`apps/manager/src/services/studio-source-admission.ts` projects audio presentation
out of source admission only: omit envelopes and cap the unused admission gain to
the previous bound. Every Manager `preview-sources` caller uses that projection,
including render source preparation. Keep source identities, ranges, timing,
references and all authorization intact. Never apply the projection to saves or
the actual preview/render document: those must retain the full audio envelope.
This is a source admission adapter, not a substitute for deploying matching
contracts to support hosted audio-edit persistence/rendering.

Regression tests run the real preview, filmstrip and waveform services against a
source validator that rejects the new audio fields. They assert that media loads
and the full edited document is unchanged. A live check with envelopes and +30dB
on every audio/video item returned all five filmstrips and HLS playlists plus six
256-peak waveforms. No extra browser request, retry loop or initialization work is
needed; only the existing source-admission payload changes.

For a volume-drag dB readout, use the dedicated `.nle-audio-gain-popover` body
portal with fixed dark/white palette colors and pointer-events none. Mount only
while volume is dragged, clear on release/cancel/lost capture, and clamp its
pointer-relative position to the viewport. Avoid generic `<output>` markup and
clip descendants: editor styles and overflow previously produced the wrong box.

The volume control has a full-width hit target and must never paint a focus
outline, including after pointer release. Use a persistent volume `:focus`
override: a `data-dragging` override alone restores the unwanted box on release.
Other audio slider outlines remain suppressed during dragging and retain
`:focus-visible` outside that gesture. Keyboard volume adjustment stays enabled.

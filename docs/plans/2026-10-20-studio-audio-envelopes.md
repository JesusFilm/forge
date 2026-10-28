# Timeline audio envelopes

Implement feat-846 on the existing audio blocks, including linked video source
audio. Keep one stored video identity; its projection edits that item's audio.

1. Add optional bounded `audioFade` data to video/audio items and extend existing
   linear amplitude volume to +30dB. Neutral helper owns dB conversion, effective
   fade durations after trims, curve evaluation and frame gain. Old documents
   retain their current levels and no fades. No GraphQL SDL change: Studio
   document/operations already transport the validated composition JSON.
2. Render an SVG volume envelope above waveforms, hover/focus corner handles for
   fade lengths and circle handles for curve shape. Volume line uses a dB scale
   (+30 at the top, -60 just above the bottom, zero/silence at bottom). Each drag
   previews locally and commits a single undoable document edit on release.
   Child gestures stop propagation to avoid clip moving/trimming/scrubbing.
   Keyboard controls, value tooltips, pointer capture and cancellation remain.
3. Use shared envelope math at timeline-relative frames in both preview and
   render; enable Remotion's Web Audio amplification for browser playback above
   1. Keep source-media identity stable and avoid refetching or re-decoding on
      envelope edits. Remove inspector audio-level fields.
4. Verify pure math, schema roundtrips, actual component gestures/undo, media
   loading counts and preview/render effective volume. Run focused scope checks.

Deployment note: optional schema additions and expanded volume bounds require
Admin's Studio JSON validator and the renderer to use this matching contracts
version. Production remains behind the normal PR-to-main deployment flow.

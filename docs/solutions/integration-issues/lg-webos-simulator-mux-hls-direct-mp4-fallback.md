---
title: "LG webOS TV Simulator rejects a live Mux HLS stream while the direct MP4 rendition plays"
date: "2026-09-04"
module: apps/webos-demo
problem_type: integration_issue
component: video-playback
severity: medium
symptoms:
  - "A Mux HLS manifest returns HTTP 200 but the HTML video element emits an error in webOS TV 26 Simulator 1.5.0"
  - "The player shows the poster and duration remains unavailable, with no decoded video frames"
root_cause: simulator_media_compatibility
resolution_type: compatibility_fallback
related_components:
  - html-video
  - mux
tags:
  - webos
  - lg-tv
  - simulator
  - video
  - hls
  - mp4
---

# Use Shaka MSE or a direct MP4 rendition for the LG webOS simulator demo

## Problem

The first `apps/webos-demo` player used a public Mux `.m3u8` stream. The
manifest returned HTTP 200 with `application/x-mpegURL`, but the HTML video
element emitted an error in webOS TV 26 Simulator 1.5.0 and rendered no frames.
This is consistent with LG's documented warning that simulator audio and video
support differs from a real TV:
<https://webostv.developer.lge.com/develop/tools/simulator-introduction>.

## Solutions

The smallest fallback is the same public Mux asset's static rendition:

```text
https://stream.mux.com/{playback-id}/720p.mp4
```

The direct rendition returned HTTP 200 with `video/mp4`. In the simulator, the
video element reported an 80-second duration, rendered changing frames, advanced
the elapsed-time display, and responded to remote play/pause input.

For adaptive playback, a pinned Shaka Player 5.2.8 bundle successfully loaded
the real JESUS Mux HLS manifest through Media Source Extensions in the same
webOS TV 26 Simulator. It reported the 2:07:53 duration, decoded advancing
frames, and exposed the English WebVTT track. This proves the rejected native
HLS path was not a Mux availability failure.

Shaka 5 no longer exposes `setTextTrackVisibility`. Selecting a track with
`selectTextTrack(track)` shows it; selecting `null` hides it. Calling the older
visibility method after `load()` made playback setup throw even though the
manifest, duration, and first cue had already loaded.

## Verification rule

For a webOS simulator video spike, do not stop at a successful manifest request
or metadata configuration. Confirm decoded frames, advancing current time, and
caption selection in the simulator. Keep real-LG-TV playback as a separate
hardware verification, because simulator media compatibility is not proof of
device behavior.

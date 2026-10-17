---
id: "feat-723"
title: "Fit complete Studio encoding within fixed output and execution limits"
owner: "tataihono"
priority: "P1"
status: "in-progress"
start_date: "2026-10-17"
duration: 1
depends_on: []
blocks: []
tags: [studio, rendering, codec, reliability]
---

## Measured boundary

After PR #2771 and matching application/VM rollout, revision-21 attempt
`cmvbw60hs0001ru937n8zmbhf` prepares in 55.733s and delivers input in 76.342s.
Native rendering begins at 04:24:59.842Z with no accumulated JPEG frames.
Read-only inspection of the video-only partial H264 stream at 04:30:09Z finds
746 complete first slices and 25,428,016 bytes: about 8% of 8856 frames have
consumed 19% of the 134,217,728-byte output limit. The preceding 202 frames take
89.25 seconds. This is a capacity warning, not a completed codec proof.

The pinned SDK defaults to CRF18 and the medium x264 preset. Bound encoding to
the actual complete duration, reserving audio/container/VBV overhead within the
existing byte cap. Select a faster contained encoder preset to reduce CPU and
lookahead memory. Preserve dimensions, frame count, frame rate, complete AAC
audio, paired streaming opt-in, CPU/memory/PID/tmpfs caps and the v3 deadline.

The same attempt fails at 04:31:19Z: the host kernel records a 2GiB cgroup OOM
and kills Chromium. At failure, the medium encoder has 414,664KiB anonymous RSS;
Chromium's killed renderer has 353,776KiB anonymous and 425,544KiB shared RSS.
The aggregate contains 1,269,620,736 anonymous and 857,350,144 shared-file bytes.
Streaming removes JPEG accumulation but does not by itself bound every cache or
encoder allocation. Measure the faster encoder's memory and inspect SDK cache
defaults before choosing any additional memory correction. The failed receipt
and physically retired assignment remain intact; the worker is drained.

The SDK forces a 4096MiB compositor tile budget in Chromium. Replace that
argument once with 256MiB in `apps/studio-render/native/chrome-launcher.c`;
preserve the backend and feature flags, reject duplicate tile arguments and
exercise the actual exec boundary. This controls tile reuse/eviction, not total
RSS or the independent image decode cache. See the pinned primary sources and
native medium/veryfast memory measurements in
`docs/plans/2026-10-17-studio-output-encoding-budget.md`.

## Entry points and verification

- `apps/studio-render/src/child.mjs`: trusted renderMedia encoding options.
- `apps/studio-render/build.mjs` and Docker runtime copies for any policy module.
- Installed `@remotion/renderer/dist/prespawn-ffmpeg.js`, `ffmpeg-args.js`,
  `crf.js` and final stitching path: ensure the rate applies to pre-encoding and
  the final video is copied rather than re-encoded without the budget.
- `apps/studio-render/test/`: actual SDK argument flow plus a native codec
  regression that verifies complete video/audio and bounded output size.

Normal PR/main and immutable hosted worker release. Fresh full revision-21
acceptance requires independent codec proof and retained verified output. Do not
rewrite the ongoing/failed attempts or infer full success from the partial stream.

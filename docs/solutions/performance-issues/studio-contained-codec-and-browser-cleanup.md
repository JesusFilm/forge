---
module: Studio
problem_type: runtime_error
tags: [studio, remotion, renderer, ffmpeg, containment, browser, qualification]
---

# Contained audio threads and recovered browser ownership

A real external-client draft with two portrait video clips, a crossfade, narration
and music exposed three independent failures in the pinned Remotion 4.0.475 runtime.
A successfully authored document or a temporary MP4 is not a successful retained
render. Preserve the admitted input and diagnose the exact composition under the
original limits before simplifying its content.

`renderMedia.ffmpegOverride` bounds the final encoder but does not reach intermediate
FFmpeg audio preprocessing and mixing. Those calls created their own decoder and
filter pools, failing with `pthread_create() failed: Resource temporarily
unavailable` under the native 96-process limit. A zero cgroup `pids.events max`
count does not rule out this separate limit. The pinned package patch bounds each
input decoder, filters and output encoder only when the trusted contained child
sets `FORGE_STUDIO_CODEC_THREADS=1` before importing the SDK. Other SDK consumers,
FFprobe and informational FFmpeg calls retain their ordinary arguments.

A recovered Chromium crash exposed another lifecycle defect: `renderFrames`
closed its original browser, while `handleBrowserCrash` had replaced that browser.
The composition finished and streamed its MP4, but the replacement process and
socket kept Node alive until the native deadline. The package patch closes the
current browser owned by the SDK. It preserves the existing caller-owned browser
path; Studio does not pass a caller-owned instance. Do not hide a leaked browser
with `process.exit()` or weaken containment limits.

Chromium surface-copy screenshots also crashed without exhausting cgroup memory,
tasks or temporary storage. The contained child enables the pinned SDK's existing
`DISABLE_FROM_SURFACE` mode. Studio admits dimensions at most 7680 pixels, below
the SDK mode's 8192-pixel limit. The original 1080×1920, 300-frame composition
then completed in 98.670 seconds under unchanged bounds; its MP4 was byte-identical
to the earlier completed but unretained output. Independent verification decoded
all video/audio and checked exact H.264 dimensions, 30fps and AAC48kHz stereo.
Sampled early, cut-adjacent and late frames retained their visible captions.

`apps/studio-render/test/codec-thread-policy.test.mjs` executes both codec launcher
variants and imports both package formats. `renderer-browser-cleanup.test.mjs`
executes the installed SDK lifecycle and real crash-replacement owner with browser,
frame and HTTP boundaries replaced. The latter fails against the unpatched
package by closing the original twice, then passes by closing original and
replacement. Actual portrait composition and independent codec proof remain
separate qualification gates recorded in `docs/validation/studio-external-agent/`.

Changes to either the child or its pinned dependency require a rebuilt renderer
image and normal deployment qualification. Local exported-service or namespace
success does not qualify sealed image startup, production capacity or clients
that were not exercised.

---
module: Studio renderer
tags: [studio, chromium, remotion, rendering, containment]
problem_type: integration_issue
---

# Chromium image parking crossed the render file limit

Long full-resolution Studio renders stopped at varying frames (284, 326–389,
758), then appeared idle until their deadline. Combining narration clips did
not fix this: Chromium's renderer process died while the parent browser and
Node process remained alive. The delayed React-frame timeout obscured the cause.

Capture kernel signal events on the renderer's threads with `perf record -e
signal:signal_generate -p PID`. Full syscall tracing changes timing enough to
hide the failure; use narrow tracing after establishing the signal. On the
retained fixture, perf captured signal 25 (`SIGXFSZ`) in `ThreadPoolForeg`.
Targeted strace confirmed termination by SIGXFSZ. Cgroup OOM and PID events were
zero. A Chrome-owned unlinked temporary file contained concatenated BMP data
and approached the native 128 MiB file-size ceiling.

Pinned Chromium 149's `ParkableImage` parks encoded image bytes through
`DiskDataAllocator`. Its default disk capacity is unlimited. The allocator
checks the `CompressParkableStrings` feature parameter `max_disk_capacity_mb`
before extending its file; that parameter also applies to parked images.
See the pinned [allocator source](https://chromium.googlesource.com/chromium/src/+/149.0.7790.0/third_party/blink/renderer/platform/disk_data_allocator.cc).

`apps/studio-render/native/chrome-launcher.c` preserves Remotion's flags and adds
`CompressParkableStrings:max_disk_capacity_mb/64` to its enabled features. It
executes the fixed image-owned Chromium path. The render image and namespace
launcher both install it. No RLIMIT, cgroup, scratch-space or deadline limit
changes. Reducing `force-gpu-mem-available-mb` alone did not resolve the failure.

## Qualification

Owned job `49149200000000000000000000000009` replayed the complete retained
Peace in the Storm revision-13 document with the same immutable render image,
changing only the browser launch parameter. It rendered and decoded all 1,800
1080×1920 frames at 30 fps, plus AAC 48 kHz stereo audio, within the normal
900-second budget. The parking file stayed at 62,208,540 bytes. Peak cgroup
memory was 1,835,929,600 bytes; OOM and PID-limit events remained zero. Both
containers were removed and the final cgroup membership was empty.

The 60,844,028-byte output has SHA-256
`2fd9470f7765411e2df357708d39f30dba07f21dedb5ad9226efe17aab4cf258`.
The retained proof records `decoded: true`, 60,000 ms video and 60,053.333 ms audio.

The released render/verify images were then qualified without runtime overrides
with six original MP3 clips, job `49149200000000000000000000000012`.
Rendering took 765 seconds and verification 24 seconds, within the unchanged
900-second budget. All 1,800 frames decoded; all six original recordings matched
at their intended ten-second boundaries (42.7 ms AAC offset, correlation
0.887–0.961). Peak memory was 1,875,300,352 bytes, with zero OOM/PID-limit events;
both containers exited zero and were removed, with empty final cgroup membership.
Output SHA-256:
`273c7ab6f5493187a4c811030ff76a749e8aded22d71ebdeb911924e35a17911`.

The native exec-boundary test protects argument preservation and rejects
ambiguous/conflicting feature configuration. It is not a substitute for the
full VM render: the one-second, low-resolution namespace smoke cannot trigger
this image-parking failure. Re-run a full-resolution changing-video fixture
when changing Chromium, Remotion, the feature parameter or file limits.

Production acceptance for the original six-clip project is recorded in
`docs/validation/studio-458/peace-in-the-storm/README.md` and feat-492.

## A separate ownership-check timeout

After this renderer release, the first live revision-16 attempt was cancelled
before frames. Manager's `/api/shorts/render-pool/owns` returned 409 after
5005 ms; the native controller was then killed by the normal cancellation path.
This was separate from Chromium's SIGXFSZ. The gateway allowed only five seconds
while the VM read allowed ten. Feat-493 records the bounded gateway alignment
and regression. Distinguish a vanished renderer from a cancelled whole job:
inspect the gateway status/timing and controller/watchdog records as well as
frame progress. A generic FAILED result alone cannot identify either cause.

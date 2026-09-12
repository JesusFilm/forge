---
id: "feat-492"
title: "Diagnose Studio render worker stalls"
owner: "tataihono"
priority: "P1"
status: "in-progress"
start_date: "2026-09-12"
duration: 2
depends_on: []
blocks: []
tags:
  - "manager"
  - "ai-pipeline"
---

## Problem

Peace in the Storm revision 12 contains six ten-second narration audio items,
one full-length music item and source footage. The production render stopped
writing frames after `element-0284.jpeg` and used almost no CPU for over ten
minutes before reporting FAILED. The preview played all six clips after reload.
Job container was `forge-studio-de976edbfba141ee96adc15a3d51954b-render`.

Revision 13 consolidates the same six recordings at 0/10/20/30/40/50 seconds
into one 60-second WAV, with no script, visual, source-volume or music change.
Its render passed frame 437 with active CPU use, then stalled after frame
758 and fell to 0.28% CPU. Consolidating audio therefore does not resolve the
worker failure. The second job was cancelled. The root cause was subsequently reproduced and captured below.

The second job had no recorded cgroup OOM kills or pids-limit events. Its
process limit was 96 and the aggregate cgroup contained 97 tasks at inspection;
that alone does not prove process allocation failure. Investigate thread
allocation and renderer progress without weakening containment limits.

## Entry Points — Read These First

1. `packages/shorts-compositions/src/studio/Composition.tsx` — audio sequences and trim.
2. `apps/studio-render/src/child.mjs` — media server, renderer and deadline.
3. `apps/studio-render/src/vm/` — retained job diagnostics.
4. `apps/manager/src/features/video-studio/preview.tsx` — preview versus render behavior.

## Grep These

- `Html5Audio|trimBefore|Sequence|timeoutInMilliseconds|renderMedia`

## What To Build

Build a deterministic owned-worker regression using multiple short MP3 clips
inside longer sequential slots plus background music and video. Compare with an
equivalent continuous WAV. Identify why rendering can remain idle beyond the
per-frame timeout and expose useful retained diagnostics on deadline failure.

## Constraints

Keep sandbox, process, memory and cumulative deadline limits intact. Do not
regenerate paid narration or alter the production project to reproduce the bug.
Retain cancelled/failed assignments as evidence. Deploy through PR-to-main.

## Verification

The exact segmented fixture must render all frames and all six audio passages.
Verify cancellation/deadline retirement, bounded diagnostics, frame transitions
and actual exported audio. A continuous-file workaround alone does not complete
this ticket.

## Diagnosis and fix — 2026-09-13

The owned VM replay of the retained 1080×1920, 30 fps, 60-second document
repeatedly loses Chromium's renderer near frames 326–389. Linux perf recorded
`signal_generate: sig=25` (`SIGXFSZ`) in `ThreadPoolForeg`, and targeted strace
confirmed renderer termination by that signal. No cgroup OOM or PID-limit event
occurred. The open, unlinked Chrome file contains concatenated BMP frame data
and grows past the native 128 MiB `RLIMIT_FSIZE`.

Pinned Chromium 149's `DiskDataAllocator` defaults to unlimited capacity.
`ParkableImage` writes encoded frame data there on a background thread. The
`CompressParkableStrings:max_disk_capacity_mb/64` feature parameter bounds that
shared allocator to 64 MiB. A native browser launcher adds this parameter while
preserving Remotion's other arguments and features. It does not change process,
file, memory, scratch-space or deadline limits. Reducing the GPU memory setting
alone did not fix the crash.

Relevant code: `apps/studio-render/native/chrome-launcher.c`,
`apps/studio-render/src/child.mjs`, `apps/studio-render/src/isolation.mjs`, and
`apps/studio-render/Dockerfile`. The launcher exec-boundary test verifies fixed
browser selection, retained arguments and rejection of ambiguous feature flags.

Full-length VM qualification and normal Studio-to-Mux acceptance remain required.
The existing one-second namespace smoke test cannot establish this regression:
image parking must run for long enough, with full-resolution changing frames,
in the actual VM worker profile. Retain the full fixture, signal trace, bounds
and decoded-output proof with the qualification record.

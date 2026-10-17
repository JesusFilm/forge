---
id: "feat-724"
title: "Reuse admitted Studio remux files without duplicate tmpfs downloads"
owner: "tataihono"
priority: "P1"
status: "in-progress"
start_date: "2026-10-17"
duration: 1
depends_on: []
blocks: []
tags: [studio, rendering, memory, sources]
---

## Measured boundary

Revision-21 attempt `cmvbxfc1u0001ruk1njy8i0v7` runs the reviewed encoding and
tile-policy fix from PR #2773. It passes the prior OOM point, but source visits
grow a second MP4 set under the SDK's `remotion-assets-dir`. Read-only SHA256
comparisons confirm all seven cached MP4s are exact copies of generated remux
files, totaling 93,483,312 bytes. Seventeen originals already occupy 247,200,184
bytes. At 2517 frames, aggregate memory is about 1.93GB under the fixed 2GiB cap.
The SDK keeps these download copies until final cleanup; its 32MiB frame-cache
limit does not govern them. Do not claim the ongoing render failed or succeeded
from this capacity measurement.

## Scope and entry points

- `apps/studio-render/src/child.mjs`: use existing composition `mediaUrls` only
  for trusted generated remux names; browser-loaded images remain HTTP assets.
- `patches/@remotion__renderer@4.0.475.patch`: narrow paired worker-only local
  source branch in CJS and ESM `assets/download-and-map-assets-to-file`.
- `packages/shorts-compositions/src/studio/Composition.tsx`: existing URL override
  seam; no app-context import or authored filesystem access.
- `pnpm-lock.yaml`: update only the patched dependency identity through pnpm.

Accept only exact `file:///tmp/studio-source-N.mp4` generated names when both
trusted codec/streaming opt-ins are enabled. Require an existing regular file,
reject symlinks, preserve cancellation and requested native audio analysis.
Return that pathname directly to native frame/audio processing. Keep default
SDK behavior and rejection of other local paths unchanged. Do not prime download
maps: stage transitions clear them. Do not bypass the public renderer wrapper.

## Verification

Exercise the actual installed downloader and proxy with the native compositor,
audio analysis and cancellation. Prove no source HTTP transfers or duplicate
files, all denied-path cases and unchanged non-worker behavior. Verify actual
child mappings and complete audible audio. Run worker tests/build, patch guards,
format and scoped CI. Normal PR/main and CI-built immutable worker release only.
Keep the ongoing attempt intact until canonical outcome or normal cancellation;
require a fresh complete independently decoded retained render for final acceptance.

## Diagnostic retirement

The existing run reaches 4689 frames / 49,807,408 encoded bytes at 05:25:38Z.
Maximum sampled aggregate usage is 2,100,133,888 bytes under the 2GiB cap,
without a limit event. It is normally cancelled before releasing the reuse fix;
the trusted switcher confirms physical retirement and inactive drain. Preserve
that CANCELLED receipt. It is neither an OOM failure nor full acceptance.

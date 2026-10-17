---
id: "feat-722"
title: "Keep full Studio execution within fixed worker resources"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-17"
duration: 1
depends_on: []
blocks: []
tags: [studio, rendering, worker, memory]
---

## Observed boundary

Revision-21 attempt `cmvbs6eh70001o7woqorh0ive` enters the render container, but
the pinned SDK selects sequential JPEG accumulation under the 2GiB memory cap.
At 02:39:28Z, 1215 frame files already occupy 145,998,045 bytes; 17 remuxed
sources separately occupy 247,200,184 bytes. The timeline requires 8856 frames
at 1080x1920. The SDK heuristic requires more than 2GB free after its estimated
encoder allocation, so this profile can never select streaming by default.

## Scope and entry points

- `apps/studio-render/src/child.mjs`: trusted startup opts into bounded streaming
  together with the existing single-thread codec policy.
- `patches/@remotion__renderer@4.0.475.patch`: preserve default behavior for other
  consumers; enable the pinned SDK streaming path only under the paired trusted
  opt-in and await each encoder write so frame buffering has backpressure.
- `apps/studio-render/test/`: exercise installed SDK decision and actual streaming
  callback under slow/erroring writes, including disabled-policy behavior.
- `pnpm-lock.yaml`: regenerate the patch identity through pnpm.

Preserve image dimensions, frame count, complete audio, source proofs and the
independent codec verifier. Keep CPU/memory/PID/tmpfs/input/output caps and original
cumulative deadlines. Do not solve frame storage growth by raising resource caps.
The measured 1602 frames at 02:41:51Z, 512.6s after native render start,
correspond to about 3.1fps; the synthetic fixture's throughput was not applicable.
Use a new immutable v3 profile with 3600s cumulative execution, 3620s request and
3900s lease, preserving exact v1/v2 history and the existing 180s preparation.
At the observed rate, 8856 frames plus input/verification need about 49 minutes;
this is capacity inference until the complete render is actually verified.
Update the native watchdog, VM/release identities and operator drain bounds
atomically. Migration 0156 extends exact snapshot-bound retention to v3.

## Verification

Reproduce the SDK's disabled streaming decision in a deterministic fixture, then
test the corrected opt-in and encoder backpressure. Run worker tests/build and
patch-consumer validation. Normal PR/main and CI-built immutable worker release,
then verify full revision 21, independent codec proof and retained output. Preserve
failed attempts and historical data.

## Full-project acceptance

All 8856 frames stream through encoding without accumulated JPEG files.
Fresh revision-21 attempt `cmvbzdb8z0001rut7o9g83y4u` is canonically SUCCEEDED
and non-stale after independent decode and retained-byte verification. Cloudflare
rejects its large final upload; authorized recovery uses normal asset/completion
services within the original issued lease, preserving every deadline and prior
receipt. Mux upload and physical retirement complete. Automatic transport is
tracked in feat-726; CPU/memory capacity qualification in feat-725.

Exact release/digest/timing and recovery evidence:
`docs/solutions/performance-issues/studio-full-render-source-preparation.md`.

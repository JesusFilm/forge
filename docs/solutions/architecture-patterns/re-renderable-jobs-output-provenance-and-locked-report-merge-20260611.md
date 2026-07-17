---
title: "Re-renderable durable jobs: provenance-stamped output records + locked field-level report merges"
category: architecture-patterns
date: 2026-06-11
tags:
  [
    workflows,
    idempotency,
    mux,
    record-before-poll,
    concurrency,
    shorts,
    manager,
    propsHash,
  ]
module: apps/manager
symptom: "After editing captions and re-rendering a short, the download served the new render but Mux playback silently showed the OLD render; separately, a draft save during rendering could revert the job phase and allow a second concurrent render workflow"
root_cause: "Single-shot job patterns (record-before-poll output records without provenance; report snapshots read once and merged wholesale after multi-minute awaits) silently break when one JobRecord can produce MULTIPLE outputs over its lifetime"
---

# Re-renderable durable jobs break two single-shot patterns

Smart Crop (feat-173) established the manager job law: record-before-poll for
external resource creation, and a metadata-artifact report merged via
read-modify-write. Both patterns assume a job renders **once**. Shorts Studio
jobs re-render after every draft edit — and both patterns failed silently,
caught only in adversarial code review (PR #1220, todos 007 + 011).

## Lesson 1 — output records need provenance when outputs can be replaced

The record-before-poll record (`shorts-mux-output-v1.json`) was keyed by
nothing: any parsed record with `ready: true` short-circuited Mux asset
creation. Re-render #2 overwrote the MP4 artifact, then reused the **old**
Mux asset — download (reads the artifact) and playback (reads Mux) diverged
forever, and the stale-output banner cleared because `lastRenderedDraftVersion`
was stamped as if the new render shipped.

**Fix/pattern:** stamp the output-defining provenance (here `propsHash`) into
the record at creation; on resume, a ready record only short-circuits when
its provenance matches the CURRENT output identity — otherwise mint a fresh
external resource and overwrite the record (keep record-before-poll ordering
and errored→recreate). Rule of thumb: **an idempotency record must contain
enough identity to answer "idempotent with respect to WHAT?"** — a bare
`{id, ready}` only protects single-shot jobs.

## Lesson 2 — report merges must be field-level inside the write lock

The shorts report (phase + counters in a metadata artifact entry) was merged
from snapshots read BEFORE the per-job write lock: the draft route read the
report, did 4–5 storage round trips, then wrote `merge(staleSnapshot,
{draftVersion})` — carrying a stale `phase` that could revert `rendering` →
`ready_for_review`, re-arming the render route's phase gate (double
workflows). The workflow itself held its snapshot across multi-minute steps
and clobbered interim writes at completion.

**Fix/pattern:** add a state-layer helper (`mergeShortsReportEntry(jobId,
patch)`) that re-reads the current entry **inside** the existing per-job
lock and merges **field-level patches**, and make every writer (routes AND
workflow persists, including `failJob`) send narrow patches through it. A
writer that cannot express its intent as a patch is writing fields it
doesn't own — that's the smell.

## Prevention

- When cloning the smart-crop/manager job law for a feature whose jobs are
  **re-launchable on the same JobRecord** (re-render, re-publish, re-sync),
  audit every cloned pattern for single-shot assumptions: output records,
  reuse/skip gates (also gate on `compositionsVersion`-style toolchain
  provenance, todo 012), report snapshots, and `failJob` fallbacks (todo 009
  — fail paths must merge onto the PERSISTED report, not an init-time stub).
- Acceptance criteria must include the second cycle: "re-X produces a new
  external resource" — the first-cycle test passes either way.
- Regression tests pinned: re-render with changed propsHash creates a new
  Mux asset; draft save during phase `rendering` cannot change phase.

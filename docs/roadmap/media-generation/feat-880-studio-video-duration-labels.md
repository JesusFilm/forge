---
id: "feat-880"
title: "Show video durations instead of asset role labels"
owner: "tataihono"
priority: "P2"
status: "complete"
start_date: "2026-10-21"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, ui]
---

## Scope

Show JFP and retained video lengths as Xm Ys rather than technical role labels.
Use existing catalog/recorded durations, and carry probed retained-video duration
on the existing lazy thumbnail response when absent. No extra browser requests.

## Verification

Workspace, thumbnail service and lifecycle tests; real local duration probe;
format/lint/diff checks and retained lazy-load/request-count guarantees.

## Result

JFP and retained video cards display compact minute/second lengths, omitting zero
units (18s, 2m, 2m 15s). Retained videos no longer show their technical asset role.
Recorded durations render immediately. Otherwise the existing thumbnail decoder
also reads input duration from its metadata and returns it in the same response;
the client updates the label without a separate request or thumbnail refetch.
Unknown lengths show a dash. Duration and still share the bounded authorized cache.

Seventeen focused workspace/loading/service/lifecycle tests pass. Assertions cover
JFP seconds-only, retained-video minutes-only, duration response/cache propagation
and client callback behavior. Initial requests and concurrency remain unchanged.
A real two-second MP4 returned durationMs 2000 with its JPEG in 65 ms through the
existing FFmpeg invocation. Lint, formatting and diff checks pass.
